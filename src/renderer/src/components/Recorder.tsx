import { useCallback, useEffect, useRef, useState } from 'react'
import type { CdpTarget, RecordedRequest, RecordingSession } from '../../../shared/types'
import { formatBytes, recordedToApiRequest, statusClass, tryPrettyJson, uid } from '../util'
import type { ApiRequest } from '../../../shared/types'
import { textPrompt } from './PromptHost'

interface Props {
  onSendToClient: (req: ApiRequest) => void
  onSaveSession: (session: RecordingSession) => void
}

type Filter = 'all' | 'xhr' | 'doc' | 'js' | 'other'

const FILTER_MAP: Record<string, Filter> = {
  XHR: 'xhr',
  Fetch: 'xhr',
  Document: 'doc',
  Script: 'js',
  Stylesheet: 'other',
  Image: 'other',
  Font: 'other',
  Media: 'other',
  WebSocket: 'other',
  Other: 'other'
}

export default function Recorder({ onSendToClient, onSaveSession }: Props): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [targets, setTargets] = useState<CdpTarget[]>([])
  const [attachedTo, setAttachedTo] = useState<CdpTarget | null>(null)
  const [records, setRecords] = useState<Map<string, RecordedRequest>>(new Map())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('xhr')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attachedRef = useRef<CdpTarget | null>(null)

  const refreshAvailability = useCallback(async (): Promise<void> => {
    const ok = await window.api.cdpIsAvailable()
    setAvailable(ok)
    if (ok) {
      try {
        setTargets(await window.api.cdpListTargets())
      } catch {
        setTargets([])
      }
    }
  }, [])

  useEffect(() => {
    void refreshAvailability()
    const offUpdate = window.api.onCdpRequestUpdate((rec) => {
      setRecords((prev) => {
        const next = new Map(prev)
        next.set(rec.requestId, rec)
        return next
      })
    })
    const offDetach = window.api.onCdpDetached(() => {
      setAttachedTo(null)
      attachedRef.current = null
      setError('Chrome tab closed or disconnected.')
    })
    return () => {
      offUpdate()
      offDetach()
    }
  }, [refreshAvailability])

  const launchChrome = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.cdpLaunchChrome()
      // Chrome takes a moment to open the debug port.
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 700))
        if (await window.api.cdpIsAvailable()) break
      }
      await refreshAvailability()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const attach = async (target: CdpTarget): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.cdpAttach(target.id)
      setAttachedTo(target)
      attachedRef.current = target
      setRecords(new Map())
      setSelectedId(null)
      setBody(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const detach = async (): Promise<void> => {
    await window.api.cdpDetach()
    setAttachedTo(null)
    attachedRef.current = null
  }

  const reload = async (): Promise<void> => {
    setRecords(new Map())
    setSelectedId(null)
    setBody(null)
    await window.api.cdpClearRecords()
    try {
      await window.api.cdpReloadPage()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const clear = async (): Promise<void> => {
    setRecords(new Map())
    setSelectedId(null)
    setBody(null)
    await window.api.cdpClearRecords()
  }

  const selectRecord = async (rec: RecordedRequest): Promise<void> => {
    setSelectedId(rec.requestId)
    setBody(null)
    if (rec.finished && !rec.failed) {
      setBody(await window.api.cdpGetBody(rec.requestId))
    }
  }

  const saveSession = async (): Promise<void> => {
    const name = (
      await textPrompt('Session name', `Recording ${new Date().toLocaleString()}`)
    )?.trim()
    if (!name) return
    const all = [...records.values()]
    const withBodies = await Promise.all(
      all.map(async (r) => ({
        ...r,
        responseBody: r.finished && !r.failed ? await window.api.cdpGetBody(r.requestId) : undefined
      }))
    )
    onSaveSession({
      id: uid(),
      name,
      timestamp: Date.now(),
      targetUrl: attachedRef.current?.url ?? '',
      requests: withBodies
    })
  }

  const list = [...records.values()]
    .filter((r) => filter === 'all' || FILTER_MAP[r.resourceType] === filter)
    .filter((r) => !search || r.url.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.startTime - b.startTime)

  const selected = selectedId ? (records.get(selectedId) ?? null) : null

  return (
    <div className="recorder">
      <div className="rec-toolbar">
        <span className={`rec-status-dot ${attachedTo ? 'live' : ''}`} />
        {available === false && (
          <>
            <span className="dim">Chrome is not running with a debug port.</span>
            <button className="btn primary" disabled={busy} onClick={launchChrome}>
              {busy ? 'Launching…' : 'Launch Chrome (debug mode)'}
            </button>
            <button className="btn" onClick={refreshAvailability}>
              Re-check
            </button>
          </>
        )}
        {available && !attachedTo && (
          <>
            <span className="dim">Attach to a tab:</span>
            <select
              onChange={(e) => {
                const t = targets.find((t) => t.id === e.target.value)
                if (t) void attach(t)
              }}
              value=""
            >
              <option value="" disabled>
                {targets.length ? 'Select tab…' : 'No tabs found'}
              </option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {(t.title || t.url).slice(0, 80)}
                </option>
              ))}
            </select>
            <button className="btn" onClick={refreshAvailability}>
              Refresh tabs
            </button>
          </>
        )}
        {attachedTo && (
          <>
            <span className="mono" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {attachedTo.title || attachedTo.url}
            </span>
            <button className="btn primary" onClick={reload}>
              ⟳ Reload &amp; Record
            </button>
            <button className="btn" onClick={clear}>
              Clear
            </button>
            <button className="btn" onClick={saveSession} disabled={records.size === 0}>
              Save Session
            </button>
            <button className="btn" onClick={detach}>
              Detach
            </button>
          </>
        )}
        <span className="spacer" />
        <div className="rec-filter">
          {(['xhr', 'doc', 'js', 'other', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`chip ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
          <input
            type="text"
            placeholder="Filter URL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="rec-split">
        <div className="rec-list">
          {list.length === 0 ? (
            <div className="empty-note">
              {attachedTo
                ? 'No requests captured yet. Hit "Reload & Record" or interact with the page.'
                : 'Attach to a Chrome tab to start recording network traffic.'}
            </div>
          ) : (
            <table className="rec-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Status</th>
                  <th>URL</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.requestId}
                    className={r.requestId === selectedId ? 'selected' : ''}
                    onClick={() => void selectRecord(r)}
                  >
                    <td className={`m-${r.method}`}>{r.method}</td>
                    <td className={statusClass(r.failed ? 0 : r.status)}>
                      {r.failed ? 'FAIL' : (r.status ?? '…')}
                    </td>
                    <td title={r.url}>{r.url}</td>
                    <td className="dim">{r.resourceType}</td>
                    <td className="dim">{formatBytes(r.encodedDataLength)}</td>
                    <td className="dim">{r.timeMs !== undefined ? `${r.timeMs} ms` : '…'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className="rec-detail">
            <div className="rec-detail-header">
              <span className={`method-tag m-${selected.method}`}>{selected.method}</span>
              <span className="url" title={selected.url}>
                {selected.url}
              </span>
              <button
                className="btn small primary"
                onClick={() => onSendToClient(recordedToApiRequest(selected))}
              >
                Open in API Client →
              </button>
            </div>
            <div className="resp-headers" style={{ flex: 'none', maxHeight: 180 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Request headers</div>
              {Object.entries(selected.requestHeaders).map(([k, v]) => (
                <div key={k}>
                  <span className="hk">{k}</span>: {v}
                </div>
              ))}
              {selected.responseHeaders && (
                <>
                  <div style={{ fontWeight: 700, margin: '10px 0 4px' }}>Response headers</div>
                  {Object.entries(selected.responseHeaders).map(([k, v]) => (
                    <div key={k}>
                      <span className="hk">{k}</span>: {v}
                    </div>
                  ))}
                </>
              )}
            </div>
            <pre className="resp-body" style={{ borderTop: '1px solid var(--border)' }}>
              {selected.failed
                ? `Request failed: ${selected.failed}`
                : body === null
                  ? 'Loading body…'
                  : tryPrettyJson(body)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
