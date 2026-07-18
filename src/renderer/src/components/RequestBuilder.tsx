import { useState } from 'react'
import type { ApiRequest, AuthConfig } from '../../../shared/types'
import KeyValueEditor from './KeyValueEditor'
import { toCurl, toFetch, toAxios } from '../lib/curl'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

interface Props {
  request: ApiRequest
  sending: boolean
  onChange: (req: ApiRequest) => void
  onSend: () => void
  onSave: () => void
}

type Tab = 'params' | 'headers' | 'body' | 'auth' | 'scripts'
type ScriptTab = 'pre' | 'post'
type Lang = 'curl' | 'fetch' | 'axios'

export default function RequestBuilder({
  request,
  sending,
  onChange,
  onSend,
  onSave
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('params')
  const [scriptTab, setScriptTab] = useState<ScriptTab>('pre')
  const [showCode, setShowCode] = useState(false)
  const [lang, setLang] = useState<Lang>('curl')
  const [copied, setCopied] = useState(false)

  const patch = (p: Partial<ApiRequest>): void => onChange({ ...request, ...p })
  const patchAuth = (a: AuthConfig): void => patch({ auth: a })

  const snippet =
    lang === 'curl' ? toCurl(request) : lang === 'fetch' ? toFetch(request) : toAxios(request)

  const copySnippet = async (): Promise<void> => {
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="req-pane">
      <div className="req-name-row">
        <input
          type="text"
          value={request.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Request name"
        />
        <button className="btn" onClick={() => setShowCode(true)} title="Code snippets">
          {'</>'} Code
        </button>
        <button className="btn" onClick={onSave}>
          Save
        </button>
      </div>

      <div className="url-row">
        <select
          className={`method m-${request.method}`}
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
            ['auth', 'Auth'],
            [
              'scripts',
              request.preRequestScript?.trim() || request.testScript?.trim()
                ? 'Scripts ●'
                : 'Scripts'
            ]
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      <div className="tab-content fade-fast" key={tab}>
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
        {tab === 'scripts' && (
          <div>
            <div className="view-switch" style={{ marginBottom: 10, width: 'fit-content' }}>
              <button
                className={scriptTab === 'pre' ? 'active' : ''}
                onClick={() => setScriptTab('pre')}
              >
                Pre-request{request.preRequestScript?.trim() ? ' ●' : ''}
              </button>
              <button
                className={scriptTab === 'post' ? 'active' : ''}
                onClick={() => setScriptTab('post')}
              >
                Post-response{request.testScript?.trim() ? ' ●' : ''}
              </button>
            </div>
            {scriptTab === 'pre' ? (
              <>
                <p className="dim" style={{ marginTop: 0 }}>
                  Runs <b>before</b> the request is sent. Set variables used in{' '}
                  <span className="mono">{'{{...}}'}</span>. Available:{' '}
                  <span className="mono">
                    pm.environment.get/set, pm.variables.set, console.log
                  </span>
                </p>
                <textarea
                  rows={11}
                  style={{ width: '100%' }}
                  value={request.preRequestScript ?? ''}
                  placeholder={`// e.g. compute a timestamp or nonce\npm.environment.set('ts', String(Date.now()))\npm.environment.set('nonce', Math.random().toString(36).slice(2))`}
                  onChange={(e) => patch({ preRequestScript: e.target.value })}
                />
              </>
            ) : (
              <>
                <p className="dim" style={{ marginTop: 0 }}>
                  Runs <b>after</b> the response arrives. Available:{' '}
                  <span className="mono">
                    pm.test, pm.expect, pm.response.code/json()/text()/headers.get(),
                    pm.environment.get/set
                  </span>
                </p>
                <textarea
                  rows={11}
                  style={{ width: '100%' }}
                  value={request.testScript ?? ''}
                  placeholder={`pm.test('status is 200', () => {\n  pm.expect(pm.response.code).to.equal(200)\n})\n\npm.test('has userId', () => {\n  pm.expect(pm.response.json()).to.have.property('userId')\n})`}
                  onChange={(e) => patch({ testScript: e.target.value })}
                />
              </>
            )}
          </div>
        )}
      </div>

      {showCode && (
        <div className="modal-overlay" onClick={() => setShowCode(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Code snippet</h3>
            <div className="row">
              {(['curl', 'fetch', 'axios'] as Lang[]).map((l) => (
                <button
                  key={l}
                  className={`chip ${lang === l ? 'active' : ''}`}
                  onClick={() => setLang(l)}
                >
                  {l}
                </button>
              ))}
              <span className="spacer" />
              <button className="btn small" onClick={() => void copySnippet()}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
              <button className="btn small" onClick={() => setShowCode(false)}>
                Close
              </button>
            </div>
            <pre className="code-snippet">{snippet}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

function count(items: { enabled: boolean; key: string }[]): string {
  const n = items.filter((i) => i.enabled && i.key).length
  return n > 0 ? ` (${n})` : ''
}
