export interface KeyValue {
  key: string
  value: string
  enabled: boolean
}

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; headerName: string; value: string }

export interface ApiRequest {
  id: string
  name: string
  method: string
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  bodyType: 'none' | 'json' | 'text' | 'form'
  body: string
  formBody: KeyValue[]
  auth: AuthConfig
  preRequestScript?: string
  testScript?: string
}

export interface ApiResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  bodyTruncated: boolean
  timeMs: number
  sizeBytes: number
  error?: string
}

export interface Folder {
  id: string
  name: string
  requests: ApiRequest[]
}

export interface Collection {
  id: string
  name: string
  folders: Folder[]
  requests: ApiRequest[]
  description?: string
  variables?: KeyValue[]
  auth?: AuthConfig
  preRequestScript?: string
  testScript?: string
}

export interface HistoryEntry {
  id: string
  timestamp: number
  request: ApiRequest
  status: number
  timeMs: number
}

export interface Environment {
  id: string
  name: string
  variables: KeyValue[]
}

export interface CdpTarget {
  id: string
  title: string
  url: string
  type: string
}

export interface RecordedRequest {
  requestId: string
  url: string
  method: string
  resourceType: string
  requestHeaders: Record<string, string>
  requestBody?: string
  status?: number
  statusText?: string
  responseHeaders?: Record<string, string>
  mimeType?: string
  startTime: number
  endTime?: number
  timeMs?: number
  encodedDataLength?: number
  failed?: string
  finished: boolean
}

export interface RecordingSession {
  id: string
  name: string
  timestamp: number
  targetUrl: string
  requests: (RecordedRequest & { responseBody?: string })[]
}
