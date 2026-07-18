import Anthropic from '@anthropic-ai/sdk'
import { storage } from './storage'
import * as cdp from './cdp'
import type { RecordedRequest, RecordingSession } from '../shared/types'

// RAG over recorded network traffic: build a corpus from the capture,
// retrieve the most relevant requests for a question, and let Claude
// answer with citations back to specific requests.

const MODEL = 'claude-opus-4-8'
const MAX_DOCS = 12
const DOC_BODY_CAP = 6_000 // chars of request/response body included per doc
const INDEX_BODY_CAP = 30_000 // chars of body scanned during retrieval

interface Settings {
  anthropicApiKey?: string
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
  searchText: string
}

export async function setApiKey(key: string): Promise<void> {
  const settings = await storage.load<Settings>('settings.json', {})
  settings.anthropicApiKey = key.trim()
  await storage.save('settings.json', settings)
}

export async function hasApiKey(): Promise<boolean> {
  const settings = await storage.load<Settings>('settings.json', {})
  return !!settings.anthropicApiKey
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
    // For live captures, pull bodies lazily for data-bearing resource types only —
    // scripts/images/fonts are noise for data-provenance questions.
    const dataBearing = ['XHR', 'Fetch', 'Document', 'Other'].includes(rec.resourceType)
    if (!responseBody && !sessionId && dataBearing && rec.finished && !rec.failed) {
      try {
        responseBody = await cdp.getResponseBody(rec.requestId)
      } catch {
        responseBody = ''
      }
    }
    const searchText = [
      rec.method,
      rec.url,
      JSON.stringify(rec.requestHeaders),
      rec.requestBody ?? '',
      JSON.stringify(rec.responseHeaders ?? {}),
      responseBody.slice(0, INDEX_BODY_CAP)
    ]
      .join('\n')
      .toLowerCase()
    docs.push({ index: i + 1, rec, responseBody, searchText })
  }
  return docs
}

// ---- retrieval ----

function tokenize(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((t) => t.length >= 3)
    )
  ]
}

/** Values quoted in the question, or long identifier-like tokens — used for provenance search. */
function extractValues(question: string): string[] {
  const quoted = [...question.matchAll(/["'`]([^"'`]{2,})["'`]/g)].map((m) => m[1])
  const identifiers = question.match(/[A-Za-z0-9_-]{12,}/g) ?? []
  return [...new Set([...quoted, ...identifiers])]
}

function scoreDoc(doc: Doc, terms: string[], values: string[]): number {
  let score = 0
  for (const term of terms) {
    if (doc.rec.url.toLowerCase().includes(term)) score += 5
    else if (doc.searchText.includes(term)) score += 2
  }
  for (const value of values) {
    const v = value.toLowerCase()
    if (doc.searchText.includes(v)) score += 10
    // Provenance signal: the value appears in this doc's RESPONSE — this doc
    // is likely the origin of the value.
    if (doc.responseBody.toLowerCase().includes(v)) score += 8
  }
  // Data-bearing requests beat static assets at equal term score.
  if (['XHR', 'Fetch', 'Document'].includes(doc.rec.resourceType)) score += 1
  return score
}

function retrieve(docs: Doc[], question: string): Doc[] {
  const terms = tokenize(question)
  const values = extractValues(question)
  const scored = docs
    .map((doc) => ({ doc, score: scoreDoc(doc, terms, values) }))
    .sort((a, b) => b.score - a.score)
  const relevant = scored.filter((s) => s.score > 0).slice(0, MAX_DOCS)
  // Nothing matched — fall back to the data-bearing requests so the model
  // can at least survey the traffic.
  if (relevant.length === 0) {
    return docs
      .filter((d) => ['XHR', 'Fetch', 'Document'].includes(d.rec.resourceType))
      .slice(0, MAX_DOCS)
  }
  return relevant.map((s) => s.doc)
}

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

// ---- ask ----

const SYSTEM_PROMPT = `You are the traffic analyst inside PostBox, an API client + network recorder.
The user recorded browser network traffic and is asking questions about it — typically where a
piece of data or a parameter comes from, which service provides what, how requests relate, or
why something failed.

You are given the most relevant recorded requests, each labeled [n]. Ground every claim in them:
- Cite requests inline as [n] whenever you reference one.
- To answer "where does X come from": look for the request whose RESPONSE contains X (its origin)
  versus requests that SEND X (its consumers), and explain the flow.
- If the recording doesn't contain the answer, say so plainly and suggest what to record next.
- Be concise and concrete: name the exact request, JSON field, header, or cookie involved.`

export async function ask(
  question: string,
  sessionId: string | null,
  history: { question: string; answer: string }[]
): Promise<AiAnswer> {
  const settings = await storage.load<Settings>('settings.json', {})
  if (!settings.anthropicApiKey) {
    return { answer: '', sources: [], error: 'No API key configured.' }
  }

  const docs = await buildCorpus(sessionId)
  const picked = retrieve(docs, question)
  const context = picked.map(renderDoc).join('\n\n')

  const client = new Anthropic({ apiKey: settings.anthropicApiKey })

  const messages: Anthropic.MessageParam[] = []
  for (const turn of history.slice(-4)) {
    messages.push({ role: 'user', content: turn.question })
    messages.push({ role: 'assistant', content: turn.answer })
  }
  messages.push({
    role: 'user',
    content: `Recorded requests (${docs.length} total captured, ${picked.length} most relevant shown):\n\n${context}\n\n---\n\nQuestion: ${question}`
  })

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages
    })

    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    // Only surface sources the model actually cited.
    const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10)))
    const sources: AiSource[] = picked
      .filter((d) => cited.has(d.index))
      .map((d) => ({
        index: d.index,
        method: d.rec.method,
        url: d.rec.url,
        status: d.rec.status
      }))

    return { answer, sources }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { answer: '', sources: [], error: 'Invalid API key. Check it in the Ask AI panel.' }
    }
    if (err instanceof Anthropic.RateLimitError) {
      return {
        answer: '',
        sources: [],
        error: 'Rate limited by the API — wait a moment and retry.'
      }
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
    return {
      answer: '',
      sources: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
