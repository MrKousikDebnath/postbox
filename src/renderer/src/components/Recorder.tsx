import { useCallback, useEffect, useRef, useState } from 'react'
import type { CdpTarget, RecordedRequest, RecordingSession } from '../../../shared/types'
import { formatBytes, recordedToApiRequest, statusClass, tryPrettyJson, uid } from '../util'
import type { ApiRequest } from '../../../shared/types'
import { textPrompt } from './PromptHost'

interface Props {
  onSendToClient: (req: ApiRequest) => void
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

type SessionRequest = RecordedRequest & { responseBody?: string }

export default function Recorder({ onSendToClient }: Props): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [targets, setTargets] = useState<CdpTarget[]>([])
  const [attachedTo, setAttachedTo] = useState<CdpTarget | null>(null)
  const [records, setRecords] = useState<Map<string, RecordedRequest>>(new Map())
  const [sessions, setSessions] = useState<RecordingSession[]>([])
  const [viewing, setViewing] = useState<RecordingSession | null>(null)
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
    void window.api.loadSessions().then(setSessions)
    // Restore live state after a view switch: the main process stays attached
    // and keeps capturing while this component is unmounted.
    void (async () => {
      const attachedId = await window.api.cdpAttachedTarget()
      if (!attachedId) return
      const recs = await window.api.cdpGetRecords()
      setRecords(new Map(recs.map((r) => [r.requestId, r])))
      let target: CdpTarget | undefined
      try {
        target = (await window.api.cdpListTargets()).find((t) => t.id === attachedId)
      } catch {
        // Chrome may be busy; fall back to a placeholder
      }
      const restored = target ?? { id: attachedId, title: 'Attached tab', url: '', type: 'page' }
      setAttachedTo(restored)
      attachedRef.current = restored
    })()
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

  // The tab list is a snapshot; poll while the user is picking a tab so
  // pages opened in the debug Chrome show up without a manual refresh.
  useEffect(() => {
    if (!available || attachedTo || viewing) return
    const timer = setInterval(() => void refreshAvailability(), 3000)
    return () => clearInterval(timer)
  }, [available, attachedTo, viewing, refreshAvailability])

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
    setViewing(null)
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
    if (viewing) {
      const saved = rec as SessionRequest
      setBody(saved.responseBody ?? '<< body was not captured in this session >>')
    } else if (rec.finished && !rec.failed) {
      setBody(await window.api.cdpGetBody(rec.requestId))
    }
  }

  const saveSession = async (): Promise<void> => {
    const name = (
      await textPrompt('Session name', `Recording ${new Date().toLocaleString()}`)
    )?.trim()
    if (!name) return
    const all = [...records.values()]
    const withBodies: SessionRequest[] = await Promise.all(
      all.map(async (r) => ({
        ...r,
        responseBody: r.finished && !r.failed ? await window.api.cdpGetBody(r.requestId) : undefined
      }))
    )
    const session: RecordingSession = {
      id: uid(),
      name,
      timestamp: Date.now(),
      targetUrl: attachedRef.current?.url ?? '',
      requests: withBodies
    }
    const next = [session, ...sessions]
    setSessions(next)
    await window.api.saveSessions(next)
  }

  const openSession = async (session: RecordingSession): Promise<void> => {
    if (attachedTo) await detach()
    setViewing(session)
    setSelectedId(null)
    setBody(null)
    setError(null)
  }

  const closeSession = (): void => {
    setViewing(null)
    setSelectedId(null)
    setBody(null)
  }

  const deleteSession = async (id: string): Promise<void> => {
    const target = sessions.find((s) => s.id === id)
    if (!confirm(`Delete session "${target?.name}"?`)) return
    const next = sessions.filter((s) => s.id !== id)
    setSessions(next)
    await window.api.saveSessions(next)
    if (viewing?.id === id) closeSession()
  }

  const source: RecordedRequest[] = viewing ? viewing.requests : [...records.values()]
  const list = source
    .filter((r) => filter === 'all' || FILTER_MAP[r.resourceType] === filter)
    .filter((r) => !search || r.url.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.startTime - b.startTime)

  const selected = selectedId ? (list.find((r) => r.requestId === selectedId) ?? null) : null

  return (
    <div className="recorder">
      <div className="rec-toolbar">
        <span className={`rec-status-dot ${attachedTo ? 'live' : ''}`} />

        {viewing && (
          <>
            <span className="dim">Viewing session:</span>
            <span className="mono" style={{ fontWeight: 700 }}>
              {viewing.name}
            </span>
            <span className="dim">
              {viewing.requests.length} requests · {new Date(viewing.timestamp).toLocaleString()}
            </span>
            <button className="btn primary" onClick={closeSession}>
              ← Back to live
            </button>
          </>
        )}

        {!viewing && available === false && (
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

        {!viewing && available && !attachedTo && (
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
            <span className="dim" style={{ fontSize: 12 }}>
              Tip: browse in the debug Chrome window (no bookmarks bar) — this list auto-refreshes.
            </span>
          </>
        )}

        {!viewing && attachedTo && (
          <>
            <span
              className="mono"
              style={{
                maxWidth: 340,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
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

        {!viewing && sessions.length > 0 && (
          <select
            title="Open a saved session"
            onChange={(e) => {
              const s = sessions.find((s) => s.id === e.target.value)
              if (s) void openSession(s)
              e.target.value = ''
            }}
            value=""
          >
            <option value="" disabled>
              📼 Sessions ({sessions.length})…
            </option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.requests.length} reqs
              </option>
            ))}
          </select>
        )}
        {viewing && (
          <button className="btn small" onClick={() => void deleteSession(viewing.id)}>
            Delete session
          </button>
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
              {viewing
                ? 'No requests in this session match the current filter.'
                : attachedTo
                  ? 'No requests captured yet. Hit "Reload & Record" or interact with the page.'
                  : 'Attach to a Chrome tab to record, or open a saved session.'}
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
