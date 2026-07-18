import type { ApiRequest, AuthConfig, Collection, Folder, KeyValue } from '../../../shared/types'

// ---------- Loose shapes for Postman Collection v2.0 / v2.1 ----------

interface PostmanKeyValue {
  key?: string
  value?: string
  disabled?: boolean
}

interface PostmanUrlObject {
  raw?: string
  protocol?: string
  host?: string | string[]
  path?: string | string[]
  query?: PostmanKeyValue[]
}

interface PostmanBody {
  mode?: string
  raw?: string
  urlencoded?: PostmanKeyValue[]
  options?: { raw?: { language?: string } }
}

interface PostmanAuth {
  type?: string
  bearer?: PostmanKeyValue[] | Record<string, string>
  basic?: PostmanKeyValue[] | Record<string, string>
  apikey?: PostmanKeyValue[] | Record<string, string>
}

interface PostmanRequest {
  method?: string
  url?: string | PostmanUrlObject
  header?: PostmanKeyValue[]
  body?: PostmanBody
  auth?: PostmanAuth
}

interface PostmanItem {
  name?: string
  request?: PostmanRequest | string
  item?: PostmanItem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------- Import ----------

function authParam(
  source: PostmanKeyValue[] | Record<string, string> | undefined,
  key: string
): string {
  if (!source) return ''
  if (Array.isArray(source)) {
    const entry = source.find((p) => p.key === key)
    return typeof entry?.value === 'string' ? entry.value : ''
  }
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

function importAuth(auth: PostmanAuth | undefined): AuthConfig {
  switch (auth?.type) {
    case 'bearer':
      return { type: 'bearer', token: authParam(auth.bearer, 'token') }
    case 'basic':
      return {
        type: 'basic',
        username: authParam(auth.basic, 'username'),
        password: authParam(auth.basic, 'password')
      }
    case 'apikey':
      return {
        type: 'apikey',
        headerName: authParam(auth.apikey, 'key'),
        value: authParam(auth.apikey, 'value')
      }
    default:
      return { type: 'none' }
  }
}

function importKeyValues(entries: PostmanKeyValue[] | undefined): KeyValue[] {
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => ({
    key: typeof entry.key === 'string' ? entry.key : '',
    value: typeof entry.value === 'string' ? entry.value : '',
    enabled: entry.disabled !== true
  }))
}

function parseQueryString(query: string): KeyValue[] {
  return query
    .split('&')
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const key = eq === -1 ? pair : pair.slice(0, eq)
      const value = eq === -1 ? '' : pair.slice(eq + 1)
      return { key, value, enabled: true }
    })
}

function importUrl(url: string | PostmanUrlObject | undefined): {
  url: string
  params: KeyValue[]
} {
  if (typeof url === 'string') {
    const qIndex = url.indexOf('?')
    if (qIndex === -1) return { url, params: [] }
    return { url: url.slice(0, qIndex), params: parseQueryString(url.slice(qIndex + 1)) }
  }
  if (!isRecord(url)) return { url: '', params: [] }

  let raw = typeof url.raw === 'string' ? url.raw : ''
  if (!raw) {
    const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '')
    const path = Array.isArray(url.path) ? url.path.join('/') : (url.path ?? '')
    raw = (url.protocol ? `${url.protocol}://` : '') + host + (path ? `/${path}` : '')
  }
  const qIndex = raw.indexOf('?')
  const base = qIndex === -1 ? raw : raw.slice(0, qIndex)
  const params = Array.isArray(url.query)
    ? importKeyValues(url.query)
    : qIndex === -1
      ? []
      : parseQueryString(raw.slice(qIndex + 1))
  return { url: base, params }
}

function looksLikeJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function importBody(
  body: PostmanBody | undefined
): Pick<ApiRequest, 'bodyType' | 'body' | 'formBody'> {
  if (body?.mode === 'raw' && typeof body.raw === 'string') {
    const isJson = body.options?.raw?.language === 'json' || looksLikeJson(body.raw)
    return { bodyType: isJson ? 'json' : 'text', body: body.raw, formBody: [] }
  }
  if (body?.mode === 'urlencoded') {
    return { bodyType: 'form', body: '', formBody: importKeyValues(body.urlencoded) }
  }
  return { bodyType: 'none', body: '', formBody: [] }
}

function importRequest(item: PostmanItem): ApiRequest {
  const request = isRecord(item.request) ? (item.request as PostmanRequest) : {}
  const rawUrl = typeof item.request === 'string' ? item.request : request.url
  const { url, params } = importUrl(rawUrl)
  return {
    id: crypto.randomUUID(),
    name: typeof item.name === 'string' ? item.name : 'Untitled request',
    method: typeof request.method === 'string' ? request.method.toUpperCase() : 'GET',
    url,
    params,
    headers: importKeyValues(request.header),
    ...importBody(request.body),
    auth: importAuth(request.auth)
  }
}

function collectRequests(items: PostmanItem[], into: ApiRequest[]): void {
  for (const item of items) {
    if (!isRecord(item)) continue
    if (item.request !== undefined) {
      into.push(importRequest(item))
    } else if (Array.isArray(item.item)) {
      // Flatten deeper nesting into the same folder
      collectRequests(item.item, into)
    }
  }
}

export function importPostmanCollection(json: unknown): Collection | null {
  if (!isRecord(json)) return null
  const info = json.info
  if (!isRecord(info) || typeof info.name !== 'string') return null
  if (!Array.isArray(json.item)) return null

  const collection: Collection = {
    id: crypto.randomUUID(),
    name: info.name,
    folders: [],
    requests: []
  }

  for (const entry of json.item as PostmanItem[]) {
    if (!isRecord(entry)) continue
    if (entry.request !== undefined) {
      collection.requests.push(importRequest(entry))
    } else if (Array.isArray(entry.item)) {
      const folder: Folder = {
        id: crypto.randomUUID(),
        name: typeof entry.name === 'string' ? entry.name : 'Untitled folder',
        requests: []
      }
      collectRequests(entry.item, folder.requests)
      collection.folders.push(folder)
    }
  }

  return collection
}

// ---------- Export ----------

function exportKeyValues(entries: KeyValue[]): PostmanKeyValue[] {
  return entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    ...(entry.enabled ? {} : { disabled: true })
  }))
}

function exportUrl(url: string, params: KeyValue[]): PostmanUrlObject {
  const queryString = params
    .filter((param) => param.enabled)
    .map((param) => `${param.key}=${param.value}`)
    .join('&')
  const raw = queryString ? `${url}?${queryString}` : url

  let protocol: string | undefined
  let rest = url
  const protocolMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)
  if (protocolMatch) {
    protocol = protocolMatch[1]
    rest = url.slice(protocolMatch[0].length)
  }
  const slashIndex = rest.indexOf('/')
  const hostPart = slashIndex === -1 ? rest : rest.slice(0, slashIndex)
  const pathPart = slashIndex === -1 ? '' : rest.slice(slashIndex + 1)

  return {
    raw,
    ...(protocol ? { protocol } : {}),
    host: hostPart.split('.').filter((segment) => segment.length > 0),
    path: pathPart ? pathPart.split('/') : [],
    query: exportKeyValues(params)
  }
}

function exportAuth(auth: AuthConfig): PostmanAuth | undefined {
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', bearer: [{ key: 'token', value: auth.token }] }
    case 'basic':
      return {
        type: 'basic',
        basic: [
          { key: 'username', value: auth.username },
          { key: 'password', value: auth.password }
        ]
      }
    case 'apikey':
      return {
        type: 'apikey',
        apikey: [
          { key: 'key', value: auth.headerName },
          { key: 'value', value: auth.value },
          { key: 'in', value: 'header' }
        ]
      }
    default:
      return undefined
  }
}

function exportBody(request: ApiRequest): PostmanBody | undefined {
  switch (request.bodyType) {
    case 'json':
      return { mode: 'raw', raw: request.body, options: { raw: { language: 'json' } } }
    case 'text':
      return { mode: 'raw', raw: request.body, options: { raw: { language: 'text' } } }
    case 'form':
      return { mode: 'urlencoded', urlencoded: exportKeyValues(request.formBody) }
    default:
      return undefined
  }
}

function exportRequest(request: ApiRequest): PostmanItem {
  const auth = exportAuth(request.auth)
  const body = exportBody(request)
  return {
    name: request.name,
    request: {
      method: request.method,
      header: exportKeyValues(request.headers),
      url: exportUrl(request.url, request.params),
      ...(body ? { body } : {}),
      ...(auth ? { auth } : {})
    }
  }
}

export function exportPostmanCollection(col: Collection): object {
  return {
    info: {
      _postman_id: crypto.randomUUID(),
      name: col.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: [
      ...col.folders.map((folder) => ({
        name: folder.name,
        item: folder.requests.map(exportRequest)
      })),
      ...col.requests.map(exportRequest)
    ]
  }
}
