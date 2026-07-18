import type { ApiRequest, Environment, KeyValue, RecordedRequest } from '../../shared/types'

export function uid(): string {
  return crypto.randomUUID()
}

export function emptyRequest(name = 'New Request'): ApiRequest {
  return {
    id: uid(),
    name,
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    bodyType: 'none',
    body: '',
    formBody: [],
    auth: { type: 'none' }
  }
}

export function substituteVariables(text: string, env: Environment | null): string {
  if (!env) return text
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const v = env.variables.find((kv) => kv.enabled && kv.key === name)
    return v ? v.value : match
  })
}

/** Resolve an ApiRequest into the concrete method/url/headers/body to execute. */
export function buildExecutable(
  req: ApiRequest,
  env: Environment | null
): { method: string; url: string; headers: Record<string, string>; body?: string } {
  const sub = (s: string): string => substituteVariables(s, env)

  let url = sub(req.url.trim())
  const enabledParams = req.params.filter((p) => p.enabled && p.key)
  if (enabledParams.length > 0) {
    const qs = enabledParams
      .map((p) => `${encodeURIComponent(sub(p.key))}=${encodeURIComponent(sub(p.value))}`)
      .join('&')
    url += (url.includes('?') ? '&' : '?') + qs
  }

  const headers: Record<string, string> = {}
  for (const h of req.headers) {
    if (h.enabled && h.key) headers[sub(h.key)] = sub(h.value)
  }

  switch (req.auth.type) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${sub(req.auth.token)}`
      break
    case 'basic':
      headers['Authorization'] =
        `Basic ${btoa(`${sub(req.auth.username)}:${sub(req.auth.password)}`)}`
      break
    case 'apikey':
      if (req.auth.headerName) headers[sub(req.auth.headerName)] = sub(req.auth.value)
      break
  }

  let body: string | undefined
  if (req.bodyType === 'json') {
    body = sub(req.body)
    if (!('content-type' in lowerKeys(headers))) headers['Content-Type'] = 'application/json'
  } else if (req.bodyType === 'text') {
    body = sub(req.body)
  } else if (req.bodyType === 'form') {
    body = req.formBody
      .filter((f) => f.enabled && f.key)
      .map((f) => `${encodeURIComponent(sub(f.key))}=${encodeURIComponent(sub(f.value))}`)
      .join('&')
    if (!('content-type' in lowerKeys(headers)))
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  return { method: req.method, url, headers, body }
}

function lowerKeys(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]))
}

/** Convert a recorded CDP request into an editable ApiRequest. */
export function recordedToApiRequest(rec: RecordedRequest): ApiRequest {
  const u = new URL(rec.url)
  const params: KeyValue[] = [...u.searchParams.entries()].map(([key, value]) => ({
    key,
    value,
    enabled: true
  }))
  // Skip pseudo-headers and headers the HTTP client sets itself.
  const skip = new Set(['content-length', 'host', 'connection'])
  const headers: KeyValue[] = Object.entries(rec.requestHeaders)
    .filter(([k]) => !k.startsWith(':') && !skip.has(k.toLowerCase()))
    .map(([key, value]) => ({ key, value, enabled: true }))

  const hasBody = rec.requestBody !== undefined && rec.requestBody !== ''
  const looksJson = hasBody && /^\s*[[{]/.test(rec.requestBody ?? '')

  return {
    id: uid(),
    name: `${rec.method} ${u.pathname.split('/').filter(Boolean).pop() ?? u.hostname}`,
    method: rec.method,
    url: `${u.origin}${u.pathname}`,
    params,
    headers,
    bodyType: hasBody ? (looksJson ? 'json' : 'text') : 'none',
    body: rec.requestBody ?? '',
    formBody: [],
    auth: { type: 'none' }
  }
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function tryPrettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function statusClass(status: number | undefined): string {
  if (status === undefined || status === 0) return 'status-err'
  if (status < 300) return 'status-2xx'
  if (status < 400) return 'status-3xx'
  if (status < 500) return 'status-4xx'
  return 'status-5xx'
}
