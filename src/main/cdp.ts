import CDP from 'chrome-remote-interface'
import { exec } from 'child_process'
import type { WebContents } from 'electron'
import type { CdpTarget, RecordedRequest } from '../shared/types'

const CDP_PORT = 9222
const MAX_RECORDED_BODY = 10 * 1024 * 1024

let client: CDP.Client | null = null
let attachedTargetId: string | null = null

// requestId -> live record; bodies fetched lazily and cached
const records = new Map<string, RecordedRequest>()
const bodies = new Map<string, string>()

export async function listTargets(): Promise<CdpTarget[]> {
  const targets = await CDP.List({ port: CDP_PORT })
  return targets
    .filter((t) => t.type === 'page')
    .map((t) => ({ id: t.id, title: t.title, url: t.url, type: t.type }))
}

export async function isChromeDebuggable(): Promise<boolean> {
  try {
    await CDP.Version({ port: CDP_PORT })
    return true
  } catch {
    return false
  }
}

export function launchChromeWithDebugPort(): Promise<void> {
  // Launches a separate Chrome instance with its own profile dir so it does not
  // conflict with (or get silently swallowed by) an already-running Chrome.
  return new Promise((resolve, reject) => {
    const cmd =
      `open -na "Google Chrome" --args --remote-debugging-port=${CDP_PORT} ` +
      `--user-data-dir="$HOME/.postbox-chrome-profile" --no-first-run`
    exec(cmd, (err) => (err ? reject(err) : resolve()))
  })
}

export async function attach(targetId: string, sender: WebContents): Promise<void> {
  await detach()
  records.clear()
  bodies.clear()

  client = await CDP({ port: CDP_PORT, target: targetId })
  attachedTargetId = targetId
  const { Network } = client

  await Network.enable({ maxTotalBufferSize: 100 * 1024 * 1024 })

  const emit = (rec: RecordedRequest) => {
    if (!sender.isDestroyed()) sender.send('cdp:request-update', rec)
  }

  Network.requestWillBeSent((p) => {
    const rec: RecordedRequest = {
      requestId: p.requestId,
      url: p.request.url,
      method: p.request.method,
      resourceType: p.type ?? 'Other',
      requestHeaders: p.request.headers as Record<string, string>,
      requestBody: p.request.postData,
      startTime: p.timestamp * 1000,
      finished: false
    }
    records.set(p.requestId, rec)
    emit(rec)
  })

  Network.responseReceived((p) => {
    const rec = records.get(p.requestId)
    if (!rec) return
    rec.status = p.response.status
    rec.statusText = p.response.statusText
    rec.responseHeaders = p.response.headers as Record<string, string>
    rec.mimeType = p.response.mimeType
    emit(rec)
  })

  Network.loadingFinished(async (p) => {
    const rec = records.get(p.requestId)
    if (!rec) return
    rec.finished = true
    rec.endTime = p.timestamp * 1000
    rec.timeMs = Math.round(rec.endTime - rec.startTime)
    rec.encodedDataLength = p.encodedDataLength
    emit(rec)
  })

  Network.loadingFailed((p) => {
    const rec = records.get(p.requestId)
    if (!rec) return
    rec.finished = true
    rec.failed = p.errorText
    emit(rec)
  })

  client.on('disconnect', () => {
    client = null
    attachedTargetId = null
    if (!sender.isDestroyed()) sender.send('cdp:detached')
  })
}

export async function getResponseBody(requestId: string): Promise<string> {
  const cached = bodies.get(requestId)
  if (cached !== undefined) return cached
  if (!client) throw new Error('Not attached to Chrome')
  const { body, base64Encoded } = await client.Network.getResponseBody({ requestId })
  let text = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body
  if (text.length > MAX_RECORDED_BODY) text = text.slice(0, MAX_RECORDED_BODY)
  bodies.set(requestId, text)
  return text
}

export function getRecords(): RecordedRequest[] {
  return [...records.values()]
}

export function clearRecords(): void {
  records.clear()
  bodies.clear()
}

export async function reloadPage(): Promise<void> {
  if (!client) throw new Error('Not attached to Chrome')
  await client.Page.enable()
  await client.Page.reload({ ignoreCache: false })
}

export async function detach(): Promise<void> {
  if (client) {
    const c = client
    client = null
    attachedTargetId = null
    try {
      await c.close()
    } catch {
      // already disconnected
    }
  }
}

export function getAttachedTarget(): string | null {
  return attachedTargetId
}
