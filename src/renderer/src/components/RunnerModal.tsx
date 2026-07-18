import { useEffect, useRef, useState } from 'react'
import type { ApiRequest, Collection, Environment } from '../../../shared/types'
import { statusClass } from '../util'
import { type TestResult } from '../lib/scripts'
import { runRequest } from '../lib/runtime'

interface Props {
  collection: Collection
  env: Environment | null
  onClose: () => void
}

interface RunRow {
  request: ApiRequest
  status?: number
  timeMs?: number
  error?: string
  tests: TestResult[]
  state: 'pending' | 'running' | 'done'
}

function allRequests(col: Collection): ApiRequest[] {
  return [...col.requests, ...col.folders.flatMap((f) => f.requests)]
}

export default function RunnerModal({ collection, env, onClose }: Props): React.JSX.Element {
  const [rows, setRows] = useState<RunRow[]>(() =>
    allRequests(collection).map((request) => ({ request, tests: [], state: 'pending' }))
  )
  const [running, setRunning] = useState(false)
  const cancelled = useRef(false)

  const run = async (): Promise<void> => {
    setRunning(true)
    cancelled.current = false
    // Live vars accumulate across requests so pm.environment.set chains through the run.
    const liveVars: Record<string, string> = {}
    for (const v of env?.variables ?? []) {
      if (v.enabled) liveVars[v.key] = v.value
    }

    const requests = allRequests(collection)
    for (let i = 0; i < requests.length; i++) {
      if (cancelled.current) break
      const req = requests[i]
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, state: 'running' } : r)))
      const liveEnv: Environment = {
        id: 'runner',
        name: 'runner',
        variables: Object.entries(liveVars).map(([key, value]) => ({ key, value, enabled: true }))
      }
      try {
        const result = await runRequest(req, collection, liveEnv)
        Object.assign(liveVars, result.envUpdates)
        const tests: TestResult[] = result.scriptError
          ? [...result.tests, { name: 'script error', passed: false, error: result.scriptError }]
          : result.tests
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  state: 'done',
                  status: result.response.status,
                  timeMs: result.response.timeMs,
                  error: result.response.error,
                  tests
                }
              : r
          )
        )
      } catch (e) {
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  state: 'done',
                  error: e instanceof Error ? e.message : String(e),
                  tests: []
                }
              : r
          )
        )
      }
    }
    setRunning(false)
  }

  useEffect(() => {
    return () => {
      cancelled.current = true
    }
  }, [])

  const done = rows.filter((r) => r.state === 'done')
  const failures = done.filter(
    (r) => r.error || (r.status ?? 0) >= 400 || r.tests.some((t) => !t.passed)
  )
  const testsTotal = done.reduce((n, r) => n + r.tests.length, 0)
  const testsPassed = done.reduce((n, r) => n + r.tests.filter((t) => t.passed).length, 0)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal runner" onClick={(e) => e.stopPropagation()}>
        <h3>▶ Run: {collection.name}</h3>
        <div className="row">
          <button className="btn primary" disabled={running || rows.length === 0} onClick={run}>
            {running ? 'Running…' : done.length > 0 ? 'Run again' : `Run ${rows.length} requests`}
          </button>
          {running && (
            <button className="btn" onClick={() => (cancelled.current = true)}>
              Stop
            </button>
          )}
          <span className="spacer" />
          {done.length > 0 && (
            <span className={failures.length ? 'status-4xx' : 'status-2xx'}>
              {done.length}/{rows.length} done · {failures.length} failed
              {testsTotal > 0 && ` · tests ${testsPassed}/${testsTotal}`}
            </span>
          )}
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="runner-rows">
          {rows.length === 0 && <div className="empty-note">This collection has no requests.</div>}
          {rows.map((r, i) => (
            <div className="runner-row" key={r.request.id + i}>
              <span className={`method-tag m-${r.request.method}`}>{r.request.method}</span>
              <span className="name">{r.request.name}</span>
              <span className="runner-result">
                {r.state === 'pending' && <span className="dim">—</span>}
                {r.state === 'running' && <span className="dim">…</span>}
                {r.state === 'done' &&
                  (r.error ? (
                    <span className="status-err" title={r.error}>
                      ERR
                    </span>
                  ) : (
                    <span className={statusClass(r.status)}>
                      {r.status} · {r.timeMs} ms
                    </span>
                  ))}
                {r.tests.length > 0 && (
                  <span
                    className={r.tests.every((t) => t.passed) ? 'status-2xx' : 'status-err'}
                    title={r.tests
                      .map(
                        (t) => `${t.passed ? '✓' : '✗'} ${t.name}${t.error ? ` — ${t.error}` : ''}`
                      )
                      .join('\n')}
                  >
                    {' '}
                    ({r.tests.filter((t) => t.passed).length}/{r.tests.length} ✓)
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
