import { useState } from 'react'
import type { ApiResponse } from '../../../shared/types'
import { formatBytes, statusClass, tryPrettyJson } from '../util'

interface Props {
  response: ApiResponse | null
}

export default function ResponseViewer({ response }: Props): React.JSX.Element {
  const [tab, setTab] = useState<'body' | 'headers'>('body')

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
        </div>
      </div>
      {tab === 'body' ? (
        <pre className="resp-body">{tryPrettyJson(response.body)}</pre>
      ) : (
        <div className="resp-headers">
          {Object.entries(response.headers).map(([k, v]) => (
            <div key={k}>
              <span className="hk">{k}</span>: {v}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
