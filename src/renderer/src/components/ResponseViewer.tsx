import { useState } from 'react'
import type { ApiResponse } from '../../../shared/types'
import { formatBytes, statusClass, tryPrettyJson } from '../util'
import type { ScriptOutcome } from '../lib/scripts'

interface Props {
  response: ApiResponse | null
  testOutcome?: ScriptOutcome | null
}

type Tab = 'body' | 'headers' | 'tests'

export default function ResponseViewer({ response, testOutcome }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('body')

  if (!response) {
    return (
      <div className="resp-pane">
        <div className="empty-note">Send a request to see the response here.</div>
      </div>
    )
  }

  if (response.error) {
    return (
      <div className="resp-pane">
        <div className="error-banner">{response.error}</div>
      </div>
    )
  }

  const tests = testOutcome?.tests ?? []
  const testsPassed = tests.filter((t) => t.passed).length
  const hasTests = tests.length > 0 || !!testOutcome?.scriptError

  return (
    <div className="resp-pane">
      <div className="resp-meta">
        <span className={statusClass(response.status)}>
          {response.status} {response.statusText}
        </span>
        <span className="dim">{response.timeMs} ms</span>
        <span className="dim">{formatBytes(response.sizeBytes)}</span>
        {response.bodyTruncated && <span className="status-4xx">body truncated at 10 MB</span>}
        <span className="spacer" />
        <div className="view-switch">
          <button className={tab === 'body' ? 'active' : ''} onClick={() => setTab('body')}>
            Body
          </button>
          <button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}>
            Headers ({Object.keys(response.headers).length})
          </button>
          {hasTests && (
            <button
              className={tab === 'tests' ? 'active' : ''}
              onClick={() => setTab('tests')}
              style={{
                color:
                  tab === 'tests'
                    ? undefined
                    : testsPassed === tests.length && !testOutcome?.scriptError
                      ? 'var(--green)'
                      : 'var(--red)'
              }}
            >
              Tests ({testsPassed}/{tests.length})
            </button>
          )}
        </div>
      </div>
      {tab === 'body' && (
        <pre className="resp-body fade-fast" key="body">
          {tryPrettyJson(response.body)}
        </pre>
      )}
      {tab === 'headers' && (
        <div className="resp-headers fade-fast" key="headers">
          {Object.entries(response.headers).map(([k, v]) => (
            <div key={k}>
              <span className="hk">{k}</span>: {v}
            </div>
          ))}
        </div>
      )}
      {tab === 'tests' && (
        <div className="resp-headers fade-fast" key="tests">
          {testOutcome?.scriptError && (
            <div className="error-banner" style={{ margin: '0 0 10px' }}>
              Script error: {testOutcome.scriptError}
            </div>
          )}
          {tests.map((t, i) => (
            <div key={i} className="test-line">
              <span className={t.passed ? 'status-2xx' : 'status-err'}>{t.passed ? '✓' : '✗'}</span>{' '}
              {t.name}
              {t.error && <span className="dim"> — {t.error}</span>}
            </div>
          ))}
          {(testOutcome?.consoleLines.length ?? 0) > 0 && (
            <>
              <div style={{ fontWeight: 700, margin: '10px 0 4px' }}>Console</div>
              {testOutcome?.consoleLines.map((l, i) => (
                <div key={i} className="dim mono">
                  {l}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
