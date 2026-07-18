import { useState } from 'react'
import type { ApiRequest, AuthConfig } from '../../../shared/types'
import KeyValueEditor from './KeyValueEditor'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

interface Props {
  request: ApiRequest
  sending: boolean
  onChange: (req: ApiRequest) => void
  onSend: () => void
  onSave: () => void
}

type Tab = 'params' | 'headers' | 'body' | 'auth'

export default function RequestBuilder({
  request,
  sending,
  onChange,
  onSend,
  onSave
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('params')

  const patch = (p: Partial<ApiRequest>): void => onChange({ ...request, ...p })
  const patchAuth = (a: AuthConfig): void => patch({ auth: a })

  return (
    <div className="req-pane">
      <div className="req-name-row">
        <input
          type="text"
          value={request.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Request name"
        />
        <button className="btn" onClick={onSave}>
          Save
        </button>
      </div>

      <div className="url-row">
        <select
          className="method"
          value={request.method}
          onChange={(e) => patch({ method: e.target.value })}
        >
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          className="url"
          type="text"
          value={request.url}
          placeholder="https://api.example.com/path — supports {{variables}}"
          onChange={(e) => patch({ url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !sending) onSend()
          }}
        />
        <button className="btn primary" disabled={sending || !request.url.trim()} onClick={onSend}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className="tab-bar">
        {(
          [
            ['params', `Params${count(request.params)}`],
            ['headers', `Headers${count(request.headers)}`],
            ['body', 'Body'],
            ['auth', 'Auth']
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === 'params' && (
          <KeyValueEditor items={request.params} onChange={(params) => patch({ params })} />
        )}
        {tab === 'headers' && (
          <KeyValueEditor items={request.headers} onChange={(headers) => patch({ headers })} />
        )}
        {tab === 'body' && (
          <div>
            <div className="row">
              {(['none', 'json', 'text', 'form'] as const).map((bt) => (
                <label key={bt} style={{ marginRight: 12, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    checked={request.bodyType === bt}
                    onChange={() => patch({ bodyType: bt })}
                  />{' '}
                  {bt === 'form' ? 'form-urlencoded' : bt}
                </label>
              ))}
            </div>
            {(request.bodyType === 'json' || request.bodyType === 'text') && (
              <textarea
                rows={10}
                style={{ width: '100%' }}
                value={request.body}
                placeholder={request.bodyType === 'json' ? '{ "key": "value" }' : 'raw body'}
                onChange={(e) => patch({ body: e.target.value })}
              />
            )}
            {request.bodyType === 'form' && (
              <KeyValueEditor
                items={request.formBody}
                onChange={(formBody) => patch({ formBody })}
              />
            )}
          </div>
        )}
        {tab === 'auth' && (
          <div>
            <div className="row">
              <span className="dim">Type</span>
              <select
                value={request.auth.type}
                onChange={(e) => {
                  const t = e.target.value
                  if (t === 'none') patchAuth({ type: 'none' })
                  else if (t === 'bearer') patchAuth({ type: 'bearer', token: '' })
                  else if (t === 'basic') patchAuth({ type: 'basic', username: '', password: '' })
                  else patchAuth({ type: 'apikey', headerName: 'X-API-Key', value: '' })
                }}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
                <option value="apikey">API Key (header)</option>
              </select>
            </div>
            {request.auth.type === 'bearer' && (
              <div className="row">
                <span className="dim">Token</span>
                <input
                  type="text"
                  style={{ flex: 1 }}
                  value={request.auth.token}
                  onChange={(e) => patchAuth({ type: 'bearer', token: e.target.value })}
                />
              </div>
            )}
            {request.auth.type === 'basic' && (
              <>
                <div className="row">
                  <span className="dim" style={{ width: 70 }}>
                    Username
                  </span>
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    value={request.auth.username}
                    onChange={(e) =>
                      patchAuth({ ...request.auth, username: e.target.value } as AuthConfig)
                    }
                  />
                </div>
                <div className="row">
                  <span className="dim" style={{ width: 70 }}>
                    Password
                  </span>
                  <input
                    type="password"
                    style={{ flex: 1 }}
                    value={request.auth.password}
                    onChange={(e) =>
                      patchAuth({ ...request.auth, password: e.target.value } as AuthConfig)
                    }
                  />
                </div>
              </>
            )}
            {request.auth.type === 'apikey' && (
              <>
                <div className="row">
                  <span className="dim" style={{ width: 70 }}>
                    Header
                  </span>
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    value={request.auth.headerName}
                    onChange={(e) =>
                      patchAuth({ ...request.auth, headerName: e.target.value } as AuthConfig)
                    }
                  />
                </div>
                <div className="row">
                  <span className="dim" style={{ width: 70 }}>
                    Value
                  </span>
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    value={request.auth.value}
                    onChange={(e) =>
                      patchAuth({ ...request.auth, value: e.target.value } as AuthConfig)
                    }
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function count(items: { enabled: boolean; key: string }[]): string {
  const n = items.filter((i) => i.enabled && i.key).length
  return n > 0 ? ` (${n})` : ''
}
