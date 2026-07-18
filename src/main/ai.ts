import Anthropic from '@anthropic-ai/sdk'
import { storage } from './storage'
import * as cdp from './cdp'
import type { RecordedRequest, RecordingSession } from '../shared/types'

// RAG over recorded network traffic. Three backends:
//   - 'local'     : fully offline, rule-based provenance analyzer (default)
//   - 'ollama'    : local LLM via Ollama at localhost:11434 (free, private)
//   - 'anthropic' : Claude API (paid, opt-in)

const ANTHROPIC_MODEL = 'claude-opus-4-8'
const OLLAMA_URL = 'http://localhost:11434'
const MAX_DOCS = 12
const DOC_BODY_CAP = 6_000
const INDEX_BODY_CAP = 30_000

export type Backend = 'local' | 'ollama' | 'anthropic'

interface Settings {
  aiBackend?: Backend
  anthropicApiKey?: string
  ollamaModel?: string
}

export interface AiSource {
  index: number
  method: string
  url: string
  status?: number
}

export interface AiAnswer {
  answer: string
  sources: AiSource[]
  error?: string
}

interface Doc {
  index: number
  rec: RecordedRequest
  responseBody: string
  requestText: string // method + url + request headers + request body (lowercased)
  responseText: string // response headers + response body (lowercased)
}

// ---- settings ----

export async function getSettings(): Promise<{
  backend: Backend
  hasAnthropicKey: boolean
  ollamaModel: string
}> {
  const s = await storage.load<Settings>('settings.json', {})
  return {
    backend: s.aiBackend ?? 'local',
    hasAnthropicKey: !!s.anthropicApiKey,
    ollamaModel: s.ollamaModel ?? ''
  }
}

export async function setBackend(backend: Backend): Promise<void> {
  const s = await storage.load<Settings>('settings.json', {})
  s.aiBackend = backend
  await storage.save('settings.json', s)
}

export async function setApiKey(key: string): Promise<void> {
  const s = await storage.load<Settings>('settings.json', {})
  s.anthropicApiKey = key.trim()
  await storage.save('settings.json', s)
}

export async function setOllamaModel(model: string): Promise<void> {
  const s = await storage.load<Settings>('settings.json', {})
  s.ollamaModel = model.trim()
  await storage.save('settings.json', s)
}

/** Probe the local Ollama server; return installed model names (empty if unavailable). */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return []
    const data = (await res.json()) as { models?: { name: string }[] }
    return (data.models ?? []).map((m) => m.name)
  } catch {
    return []
  }
}

// ---- corpus ----

async function buildCorpus(sessionId: string | null): Promise<Doc[]> {
  let records: (RecordedRequest & { responseBody?: string })[]
  if (sessionId) {
    const sessions = await storage.load<RecordingSession[]>('sessions.json', [])
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) throw new Error('Saved session not found')
    records = session.requests
  } else {
    records = cdp.getRecords()
  }
  if (records.length === 0) {
    throw new Error('No recorded requests. Record some traffic first, or open a saved session.')
  }

  const docs: Doc[] = []
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    let responseBody = rec.responseBody ?? ''
    const dataBearing = ['XHR', 'Fetch', 'Document', 'Other'].includes(rec.resourceType)
    if (!responseBody && !sessionId && dataBearing && rec.finished && !rec.failed) {
      try {
        responseBody = await cdp.getResponseBody(rec.requestId)
      } catch {
        responseBody = ''
      }
    }
    const requestText = [
      rec.method,
      rec.url,
      JSON.stringify(rec.requestHeaders),
      rec.requestBody ?? ''
    ]
      .join('\n')
      .toLowerCase()
    const responseText = [
      JSON.stringify(rec.responseHeaders ?? {}),
      responseBody.slice(0, INDEX_BODY_CAP)
    ]
      .join('\n')
      .toLowerCase()
    docs.push({ index: i + 1, rec, responseBody, requestText, responseText })
  }
  return docs
}

// ---- shared retrieval helpers ----

const STOPWORDS = new Set([
  'the',
  'this',
  'that',
  'where',
  'does',
  'come',
  'from',
  'what',
  'which',
  'why',
  'how',
  'when',
  'who',
  'and',
  'for',
  'are',
  'was',
  'value',
  'parameter',
  'param',
  'request',
  'requests',
  'response',
  'header',
  'headers',
  'field',
  'data',
  'call',
  'calls',
  'api',
  'get',
  'set',
  'send',
  'sent',
  'used',
  'use',
  'coming',
  'generated',
  'origin',
  'source'
])

/** Candidate subjects the user is asking about: quoted strings, identifiers, non-stopwords. */
function extractSubjects(question: string): string[] {
  const quoted = [...question.matchAll(/["'`]([^"'`]{2,})["'`]/g)].map((m) => m[1])
  const identifiers = question.match(/[A-Za-z_][A-Za-z0-9_]*[A-Za-z0-9]/g) ?? []
  const subjects: string[] = [...quoted]
  for (const id of identifiers) {
    if (id.length < 3) continue
    if (STOPWORDS.has(id.toLowerCase())) continue
    // camelCase / snake_case / long identifiers are strong candidates; keep others too
    subjects.push(id)
  }
  return [...new Set(subjects)]
}

function tokenize(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    )
  ]
}

function scoreDoc(doc: Doc, terms: string[], subjects: string[]): number {
  let score = 0
  for (const term of terms) {
    if (doc.rec.url.toLowerCase().includes(term)) score += 5
    else if (doc.requestText.includes(term) || doc.responseText.includes(term)) score += 2
  }
  for (const subject of subjects) {
    const s = subject.toLowerCase()
    if (doc.responseText.includes(s)) score += 10 // provenance: value emitted here
    if (doc.requestText.includes(s)) score += 6 // consumer: value sent here
  }
  if (['XHR', 'Fetch', 'Document'].includes(doc.rec.resourceType)) score += 1
  return score
}

function retrieve(docs: Doc[], question: string): Doc[] {
  const terms = tokenize(question)
  const subjects = extractSubjects(question)
  const scored = docs
    .map((doc) => ({ doc, score: scoreDoc(doc, terms, subjects) }))
    .sort((a, b) => b.score - a.score)
  const relevant = scored.filter((s) => s.score > 0).slice(0, MAX_DOCS)
  if (relevant.length === 0) {
    return docs
      .filter((d) => ['XHR', 'Fetch', 'Document'].includes(d.rec.resourceType))
      .slice(0, MAX_DOCS)
  }
  return relevant.map((s) => s.doc)
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.origin + u.pathname
  } catch {
    return url
  }
}

function sourcesFrom(docs: Doc[]): AiSource[] {
  return docs.map((d) => ({
    index: d.index,
    method: d.rec.method,
    url: d.rec.url,
    status: d.rec.status
  }))
}

// ---- backend 1: fully local provenance analyzer ----

function analyzeLocal(docs: Doc[], question: string): AiAnswer {
  const subjects = extractSubjects(question)

  // Pick the subject that actually appears in the captured traffic.
  let best: { subject: string; origins: Doc[]; consumers: Doc[] } | null = null
  for (const subject of subjects) {
    const s = subject.toLowerCase()
    const origins = docs.filter((d) => d.responseText.includes(s))
    const consumers = docs.filter((d) => d.requestText.includes(s))
    if (origins.length + consumers.length === 0) continue
    const total = origins.length + consumers.length
    if (!best || total > best.origins.length + best.consumers.length) {
      best = { subject, origins, consumers }
    }
  }

  if (best) {
    const lines: string[] = []
    const { subject, origins, consumers } = best
    lines.push(`**"${subject}"** in the recorded traffic:`)
    lines.push('')

    if (origins.length > 0) {
      lines.push(
        `**Origin — it appears in the RESPONSE of ${origins.length} request${origins.length > 1 ? 's' : ''}** (this is where it is produced):`
      )
      for (const d of origins.slice(0, 6)) {
        lines.push(`- [${d.index}] ${d.rec.method} ${shortUrl(d.rec.url)}`)
      }
      lines.push('')
    } else {
      lines.push(
        `It does **not** appear in any recorded response body/headers, so its origin was not captured — it may be set by a request made before you attached, computed in client-side JavaScript, or read from a cookie/localStorage set earlier.`
      )
      lines.push('')
    }

    if (consumers.length > 0) {
      lines.push(
        `**Consumers — it is SENT in ${consumers.length} request${consumers.length > 1 ? 's' : ''}** (URL, headers, or body):`
      )
      for (const d of consumers.slice(0, 6)) {
        lines.push(`- [${d.index}] ${d.rec.method} ${shortUrl(d.rec.url)}`)
      }
      lines.push('')
    }

    if (origins.length > 0 && consumers.length > 0) {
      lines.push(
        `So the flow is: request [${origins[0].index}] returns "${subject}" in its response, and it is then reused as input to the request(s) above.`
      )
    }

    lines.push('')
    lines.push(
      '_Local analysis (offline). For richer natural-language answers, switch backend to Ollama or Claude API._'
    )

    const used = [...new Set([...origins, ...consumers])].slice(0, MAX_DOCS)
    return { answer: lines.join('\n'), sources: sourcesFrom(used) }
  }

  // No subject matched — keyword search fallback: list the most relevant requests.
  const picked = retrieve(docs, question)
  const lines: string[] = []
  lines.push(
    `I couldn't pin the exact term to a request offline. Here are the ${picked.length} most relevant recorded requests for your question:`
  )
  lines.push('')
  for (const d of picked) {
    const status = d.rec.failed ? 'FAILED' : (d.rec.status ?? '')
    lines.push(`- [${d.index}] ${d.rec.method} ${status} ${shortUrl(d.rec.url)}`)
  }
  lines.push('')
  lines.push(
    '_Local analysis (offline). Tip: put the exact key/value in quotes, e.g. "deviceUserAgentId". For free-form answers, switch backend to Ollama or Claude API._'
  )
  return { answer: lines.join('\n'), sources: sourcesFrom(picked) }
}

// ---- shared LLM context rendering ----

function renderDoc(doc: Doc): string {
  const r = doc.rec
  const parts = [
    `### Request [${doc.index}]`,
    `${r.method} ${r.url}`,
    `Type: ${r.resourceType} | Status: ${r.failed ? `FAILED (${r.failed})` : (r.status ?? 'pending')} | Time: ${r.timeMs ?? '?'} ms`,
    `Request headers: ${JSON.stringify(r.requestHeaders)}`
  ]
  if (r.requestBody) parts.push(`Request body: ${r.requestBody.slice(0, DOC_BODY_CAP)}`)
  if (r.responseHeaders) parts.push(`Response headers: ${JSON.stringify(r.responseHeaders)}`)
  if (doc.responseBody) {
    const truncated = doc.responseBody.length > DOC_BODY_CAP
    parts.push(
      `Response body${truncated ? ' (truncated)' : ''}: ${doc.responseBody.slice(0, DOC_BODY_CAP)}`
    )
  }
  return parts.join('\n')
}

const SYSTEM_PROMPT = `You are the traffic analyst inside PostBox, an API client + network recorder.
The user recorded browser network traffic and asks about it — typically where a piece of data or a
parameter comes from, which service provides what, how requests relate, or why something failed.

You are given the most relevant recorded requests, each labeled [n]. Ground every claim in them:
- Cite requests inline as [n] whenever you reference one.
- To answer "where does X come from": find the request whose RESPONSE contains X (its origin) vs the
  requests that SEND X (its consumers), and explain the flow.
- If the recording doesn't contain the answer, say so plainly.
- Be concise and concrete: name the exact request, JSON field, header, or cookie involved.`

function citedSources(answer: string, picked: Doc[]): AiSource[] {
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10)))
  return sourcesFrom(picked.filter((d) => cited.has(d.index)))
}

function buildUserPrompt(docs: Doc[], picked: Doc[], question: string): string {
  const context = picked.map(renderDoc).join('\n\n')
  return `Recorded requests (${docs.length} total captured, ${picked.length} most relevant shown):\n\n${context}\n\n---\n\nQuestion: ${question}`
}

// ---- backend 2: Ollama (local LLM) ----

async function askOllama(
  docs: Doc[],
  question: string,
  history: { question: string; answer: string }[],
  model: string
): Promise<AiAnswer> {
  if (!model) {
    return { answer: '', sources: [], error: 'No Ollama model selected. Pick one in the panel.' }
  }
  const picked = retrieve(docs, question)
  const messages: { role: string; content: string }[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const turn of history.slice(-4)) {
    messages.push({ role: 'user', content: turn.question })
    messages.push({ role: 'assistant', content: turn.answer })
  }
  messages.push({ role: 'user', content: buildUserPrompt(docs, picked, question) })

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false })
    })
    if (!res.ok) {
      return {
        answer: '',
        sources: [],
        error: `Ollama returned ${res.status}. Is the model "${model}" pulled? Try: ollama pull ${model}`
      }
    }
    const data = (await res.json()) as { message?: { content?: string } }
    const answer = data.message?.content ?? ''
    return { answer, sources: citedSources(answer, picked) }
  } catch (err) {
    return {
      answer: '',
      sources: [],
      error: `Could not reach Ollama at ${OLLAMA_URL}. Install from ollama.com and run it. (${err instanceof Error ? err.message : String(err)})`
    }
  }
}

// ---- backend 3: Anthropic (paid, opt-in) ----

async function askAnthropic(
  docs: Doc[],
  question: string,
  history: { question: string; answer: string }[],
  apiKey: string
): Promise<AiAnswer> {
  const picked = retrieve(docs, question)
  const client = new Anthropic({ apiKey })
  const messages: Anthropic.MessageParam[] = []
  for (const turn of history.slice(-4)) {
    messages.push({ role: 'user', content: turn.question })
    messages.push({ role: 'assistant', content: turn.answer })
  }
  messages.push({ role: 'user', content: buildUserPrompt(docs, picked, question) })

  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages
    })
    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    return { answer, sources: citedSources(answer, picked) }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { answer: '', sources: [], error: 'Invalid API key. Check it in the panel.' }
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { answer: '', sources: [], error: 'Rate limited — wait a moment and retry.' }
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return {
        answer: '',
        sources: [],
        error: 'Could not reach the Anthropic API — check your network.'
      }
    }
    if (err instanceof Anthropic.APIError) {
      return { answer: '', sources: [], error: `API error ${err.status}: ${err.message}` }
    }
    return { answer: '', sources: [], error: err instanceof Error ? err.message : String(err) }
  }
}

// ---- entry point ----

export async function ask(
  question: string,
  sessionId: string | null,
  history: { question: string; answer: string }[]
): Promise<AiAnswer> {
  const s = await storage.load<Settings>('settings.json', {})
  const backend: Backend = s.aiBackend ?? 'local'

  let docs: Doc[]
  try {
    docs = await buildCorpus(sessionId)
  } catch (err) {
    return { answer: '', sources: [], error: err instanceof Error ? err.message : String(err) }
  }

  if (backend === 'local') return analyzeLocal(docs, question)
  if (backend === 'ollama') return askOllama(docs, question, history, s.ollamaModel ?? '')
  if (backend === 'anthropic') {
    if (!s.anthropicApiKey) {
      return { answer: '', sources: [], error: 'No Anthropic API key configured.' }
    }
    return askAnthropic(docs, question, history, s.anthropicApiKey)
  }
  return { answer: '', sources: [], error: `Unknown backend: ${backend}` }
}
