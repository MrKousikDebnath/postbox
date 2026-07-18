import type { ApiResponse } from '../shared/types'

const MAX_BODY_BYTES = 10 * 1024 * 1024 // 10 MB cap on displayed response bodies
const TIMEOUT_MS = 60_000

export interface ExecutableRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export async function executeRequest(req: ExecutableRequest): Promise<ApiResponse> {
  const start = performance.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const hasBody = req.body !== undefined && !['GET', 'HEAD'].includes(req.method.toUpperCase())
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? req.body : undefined,
      redirect: 'follow',
      signal: controller.signal
    })
    clearTimeout(timer)

    const buf = Buffer.from(await res.arrayBuffer())
    const timeMs = Math.round(performance.now() - start)
    const truncated = buf.length > MAX_BODY_BYTES
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => (headers[k] = v))

    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      body: buf.subarray(0, MAX_BODY_BYTES).toString('utf-8'),
      bodyTruncated: truncated,
      timeMs,
      sizeBytes: buf.length
    }
  } catch (err) {
    const timeMs = Math.round(performance.now() - start)
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? `Request timed out after ${TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.cause instanceof Error
            ? `${err.message}: ${err.cause.message}`
            : err.message
          : String(err)
    return {
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      bodyTruncated: false,
      timeMs,
      sizeBytes: 0,
      error: message
    }
  }
}
