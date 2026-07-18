import type { ApiRequest, AuthConfig, KeyValue } from '../../../shared/types'

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary'])
const URLENCODE_FLAGS = new Set(['--data-urlencode', '--data-urlencoded'])
const FORM_FLAGS = new Set(['-F', '--form'])
const HEADER_FLAGS = new Set(['-H', '--header'])
// Known value-taking flags we ignore so their values are not mistaken for URLs
const IGNORED_VALUE_FLAGS = new Set([
  '-o',
  '--output',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '-b',
  '--cookie',
  '--connect-timeout',
  '--max-time',
  '-m',
  '--retry',
  '--cacert',
  '--cert',
  '--key'
])

const ANSI_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '0': '\0'
}

/** Tokenize a shell-like command, handling quotes, $'...' strings and line continuations. */
function tokenize(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasCurrent = false
  let i = 0

  const flush = (): void => {
    if (hasCurrent) {
      tokens.push(current)
      current = ''
      hasCurrent = false
    }
  }

  while (i < command.length) {
    const ch = command[i]

    if (ch === '\\') {
      const next = command[i + 1]
      if (next === '\n') {
        i += 2 // line continuation
      } else if (next === '\r' && command[i + 2] === '\n') {
        i += 3
      } else if (next === undefined) {
        i += 1
      } else {
        current += next
        hasCurrent = true
        i += 2
      }
      continue
    }

    if (ch === '$' && command[i + 1] === "'") {
      // ANSI-C quoted string $'...'
      i += 2
      hasCurrent = true
      while (i < command.length && command[i] !== "'") {
        if (command[i] === '\\' && i + 1 < command.length) {
          const esc = command[i + 1]
          current += ANSI_ESCAPES[esc] ?? '\\' + esc
          i += 2
        } else {
          current += command[i]
          i += 1
        }
      }
      i += 1 // closing quote
      continue
    }

    if (ch === "'") {
      i += 1
      hasCurrent = true
      while (i < command.length && command[i] !== "'") {
        current += command[i]
        i += 1
      }
      i += 1
      continue
    }

    if (ch === '"') {
      i += 1
      hasCurrent = true
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && ['"', '\\', '$', '`'].includes(command[i + 1])) {
          current += command[i + 1]
          i += 2
        } else {
          current += command[i]
          i += 1
        }
      }
      i += 1
      continue
    }

    if (/\s/.test(ch)) {
      flush()
      i += 1
      continue
    }

    current += ch
    hasCurrent = true
    i += 1
  }
  flush()
  return tokens
}

function looksLikeUrl(token: string): boolean {
  if (token.startsWith('-')) return false
  if (/^https?:\/\//i.test(token)) return true
  return /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(token)
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/** Split a URL into its base (without query) and parsed query params. */
function splitUrl(rawUrl: string): { url: string; params: KeyValue[] } {
  const qIndex = rawUrl.indexOf('?')
  if (qIndex === -1) return { url: rawUrl, params: [] }
  const base = rawUrl.slice(0, qIndex)
  const query = rawUrl.slice(qIndex + 1)
  const params: KeyValue[] = []
  for (const pair of query.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = eq === -1 ? pair : pair.slice(0, eq)
    const value = eq === -1 ? '' : pair.slice(eq + 1)
    params.push({ key: safeDecode(key), value: safeDecode(value), enabled: true })
  }
  return { url: base, params }
}

function hostnameOf(url: string): string {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`)
    return parsed.hostname
  } catch {
    return url
  }
}

export function parseCurl(command: string): Omit<ApiRequest, 'id'> | null {
  const tokens = tokenize(command)
  if (tokens.length === 0) return null

  let method = ''
  let url = ''
  const headers: KeyValue[] = []
  const dataParts: string[] = []
  const formBody: KeyValue[] = []
  let auth: AuthConfig = { type: 'none' }

  let start = 0
  if (tokens[0] === 'curl') start = 1

  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i]

    if (token === '-X' || token === '--request') {
      method = (tokens[++i] ?? '').toUpperCase()
    } else if (token.startsWith('--request=')) {
      method = token.slice('--request='.length).toUpperCase()
    } else if (token.startsWith('-X') && token.length > 2) {
      method = token.slice(2).toUpperCase()
    } else if (HEADER_FLAGS.has(token)) {
      const raw = tokens[++i] ?? ''
      const colon = raw.indexOf(':')
      const key = colon === -1 ? raw : raw.slice(0, colon).trim()
      const value = colon === -1 ? '' : raw.slice(colon + 1).trim()
      if (key.toLowerCase() === 'authorization' && /^bearer\s+/i.test(value)) {
        auth = { type: 'bearer', token: value.replace(/^bearer\s+/i, '') }
      } else if (key) {
        headers.push({ key, value, enabled: true })
      }
    } else if (DATA_FLAGS.has(token) || URLENCODE_FLAGS.has(token)) {
      const value = tokens[++i]
      if (value !== undefined) dataParts.push(value)
    } else if (FORM_FLAGS.has(token)) {
      const raw = tokens[++i] ?? ''
      const eq = raw.indexOf('=')
      const key = eq === -1 ? raw : raw.slice(0, eq)
      const value = eq === -1 ? '' : raw.slice(eq + 1)
      if (key) formBody.push({ key, value, enabled: true })
    } else if (token === '-u' || token === '--user') {
      const raw = tokens[++i] ?? ''
      const colon = raw.indexOf(':')
      auth = {
        type: 'basic',
        username: colon === -1 ? raw : raw.slice(0, colon),
        password: colon === -1 ? '' : raw.slice(colon + 1)
      }
    } else if (token === '--url') {
      url = tokens[++i] ?? ''
    } else if (IGNORED_VALUE_FLAGS.has(token)) {
      i += 1
    } else if (!token.startsWith('-') && !url && looksLikeUrl(token)) {
      url = token
    }
  }

  if (!url) return null

  const { url: baseUrl, params } = splitUrl(url)

  let bodyType: ApiRequest['bodyType'] = 'none'
  let body = ''
  if (formBody.length > 0) {
    bodyType = 'form'
  } else if (dataParts.length > 0) {
    body = dataParts.join('&')
    const trimmed = body.trim()
    bodyType = trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'text'
  }

  if (!method) method = bodyType === 'none' ? 'GET' : 'POST'

  return {
    name: `${method} ${hostnameOf(baseUrl)}`,
    method,
    url: baseUrl,
    params,
    headers,
    bodyType,
    body,
    formBody,
    auth
  }
}

/** Single-quote a string for shell usage. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/** Quote a string as a JavaScript single-quoted literal. */
function jsQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

function fullUrl(req: ApiRequest): string {
  const enabled = req.params.filter((p) => p.enabled && p.key)
  if (enabled.length === 0) return req.url
  const query = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return `${req.url}${req.url.includes('?') ? '&' : '?'}${query}`
}

function enabledHeaders(req: ApiRequest): KeyValue[] {
  return req.headers.filter((h) => h.enabled && h.key)
}

export function toCurl(req: ApiRequest): string {
  const parts: string[] = [`curl -X ${req.method} ${shellQuote(fullUrl(req))}`]

  for (const h of enabledHeaders(req)) {
    parts.push(`-H ${shellQuote(`${h.key}: ${h.value}`)}`)
  }

  if (req.auth.type === 'bearer') {
    parts.push(`-H ${shellQuote(`Authorization: Bearer ${req.auth.token}`)}`)
  } else if (req.auth.type === 'basic') {
    parts.push(`-u ${shellQuote(`${req.auth.username}:${req.auth.password}`)}`)
  } else if (req.auth.type === 'apikey') {
    parts.push(`-H ${shellQuote(`${req.auth.headerName}: ${req.auth.value}`)}`)
  }

  if (req.bodyType === 'json' || req.bodyType === 'text') {
    if (req.body) parts.push(`-d ${shellQuote(req.body)}`)
  } else if (req.bodyType === 'form') {
    for (const f of req.formBody.filter((p) => p.enabled && p.key)) {
      parts.push(`--data-urlencode ${shellQuote(`${f.key}=${f.value}`)}`)
    }
  }

  return parts.join(' \\\n  ')
}

/** Header entries as [key, JS value expression] pairs, including auth. */
function headerEntries(req: ApiRequest): Array<[string, string]> {
  const entries: Array<[string, string]> = enabledHeaders(req).map((h) => [h.key, jsQuote(h.value)])
  if (req.auth.type === 'bearer') {
    entries.push(['Authorization', jsQuote(`Bearer ${req.auth.token}`)])
  } else if (req.auth.type === 'basic') {
    entries.push([
      'Authorization',
      `'Basic ' + btoa(${jsQuote(`${req.auth.username}:${req.auth.password}`)})`
    ])
  } else if (req.auth.type === 'apikey') {
    entries.push([req.auth.headerName, jsQuote(req.auth.value)])
  }
  return entries
}

function headersBlock(entries: Array<[string, string]>, indent: string): string {
  const inner = entries.map(([k, v]) => `${indent}  ${jsQuote(k)}: ${v}`).join(',\n')
  return `{\n${inner}\n${indent}}`
}

function bodyExpression(req: ApiRequest): string | null {
  if (req.bodyType === 'json' || req.bodyType === 'text') {
    return req.body ? jsQuote(req.body) : null
  }
  if (req.bodyType === 'form') {
    const items = req.formBody
      .filter((p) => p.enabled && p.key)
      .map((p) => `[${jsQuote(p.key)}, ${jsQuote(p.value)}]`)
      .join(', ')
    return `new URLSearchParams([${items}]).toString()`
  }
  return null
}

export function toFetch(req: ApiRequest): string {
  const entries = headerEntries(req)
  const body = bodyExpression(req)
  const lines: string[] = [`const response = await fetch(${jsQuote(fullUrl(req))}, {`]
  lines.push(`  method: ${jsQuote(req.method)},`)
  if (entries.length > 0) {
    lines.push(`  headers: ${headersBlock(entries, '  ')},`)
  }
  if (body !== null) {
    lines.push(`  body: ${body},`)
  }
  // strip trailing comma from last option line
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '')
  lines.push('})')
  lines.push('const data = await response.json()')
  lines.push('console.log(data)')
  return lines.join('\n')
}

export function toAxios(req: ApiRequest): string {
  const entries = headerEntries(req).filter(
    ([key]) => !(req.auth.type === 'basic' && key === 'Authorization')
  )
  const body = bodyExpression(req)
  const lines: string[] = ['const response = await axios({']
  lines.push(`  method: ${jsQuote(req.method.toLowerCase())},`)
  lines.push(`  url: ${jsQuote(fullUrl(req))},`)
  if (entries.length > 0) {
    lines.push(`  headers: ${headersBlock(entries, '  ')},`)
  }
  if (req.auth.type === 'basic') {
    lines.push(
      `  auth: { username: ${jsQuote(req.auth.username)}, password: ${jsQuote(req.auth.password)} },`
    )
  }
  if (body !== null) {
    lines.push(`  data: ${body},`)
  }
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '')
  lines.push('})')
  lines.push('console.log(response.data)')
  return lines.join('\n')
}
