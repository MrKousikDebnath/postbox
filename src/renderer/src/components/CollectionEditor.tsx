import { useState } from 'react'
import type { AuthConfig, Collection } from '../../../shared/types'
import KeyValueEditor from './KeyValueEditor'

interface Props {
  collection: Collection
  onChange: (col: Collection) => void
  onRun: (col: Collection) => void
  onClose: () => void
}

type Tab = 'overview' | 'auth' | 'scripts' | 'variables'
type ScriptTab = 'pre' | 'post'

export default function CollectionEditor({
  collection,
  onChange,
  onRun,
  onClose
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview')
  const [scriptTab, setScriptTab] = useState<ScriptTab>('pre')

  const patch = (p: Partial<Collection>): void => onChange({ ...collection, ...p })
  const auth: AuthConfig = collection.auth ?? { type: 'none' }
  const patchAuth = (a: AuthConfig): void => patch({ auth: a })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0, flex: 1 }}>📁 {collection.name}</h3>
          <button className="btn small" onClick={() => onRun(collection)}>
            ▶ Run
          </button>
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="tab-bar" style={{ padding: 0, marginBottom: 10 }}>
          {(
            [
              ['overview', 'Overview'],
              ['auth', 'Authorization'],
              [
                'scripts',
                collection.preRequestScript?.trim() || collection.testScript?.trim()
                  ? 'Scripts ●'
                  : 'Scripts'
              ],
              ['variables', 'Variables']
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div>
            <p className="dim" style={{ marginTop: 0 }}>
              Notes about this collection (Markdown-ish, free text).
            </p>
            <textarea
              rows={10}
              style={{ width: '100%' }}
              placeholder="What is this collection for?"
              value={collection.description ?? ''}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>
        )}

        {tab === 'auth' && (
          <div>
            <p className="dim" style={{ marginTop: 0 }}>
              Default auth for requests in this collection whose own auth is “None”.
            </p>
            <div className="row">
              <span className="dim">Type</span>
              <select
                value={auth.type}
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
            {auth.type === 'bearer' && (
              <div className="row">
                <span className="dim">Token</span>
                <input
                  type="text"
                  style={{ flex: 1 }}
                  value={auth.token}
                  onChange={(e) => patchAuth({ type: 'bearer', token: e.target.value })}
                />
              </div>
            )}
            {auth.type === 'basic' && (
              <>
                <div className="row">
                  <span className="dim" style={{ width: 70 }}>
                    Username
                  </span>
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    value={auth.username}
                    onChange={(e) => patchAuth({ ...auth, username: e.target.value } as AuthConfig)}
                  />
                </div>
                <div className="row">
                  <span className="dim" style={{ width: 70 }}>
                    Password
                  </span>
                  <input
                    type="password"
                    style={{ flex: 1 }}
                    value={auth.password}
                    onChange={(e) => patchAuth({ ...auth, password: e.target.value } as AuthConfig)}
                  />
                </div>
              </>
            )}
            {auth.type === 'apikey' && (
              <>
                <div className="row">
                  <span className="dim" style={{ width: 70 }}>
                    Header
                  </span>
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    value={auth.headerName}
                    onChange={(e) =>
                      patchAuth({ ...auth, headerName: e.target.value } as AuthConfig)
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
                    value={auth.value}
                    onChange={(e) => patchAuth({ ...auth, value: e.target.value } as AuthConfig)}
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
                Pre-request{collection.preRequestScript?.trim() ? ' ●' : ''}
              </button>
              <button
                className={scriptTab === 'post' ? 'active' : ''}
                onClick={() => setScriptTab('post')}
              >
                Post-response{collection.testScript?.trim() ? ' ●' : ''}
              </button>
            </div>
            {scriptTab === 'pre' ? (
              <>
                <p className="dim" style={{ marginTop: 0 }}>
                  Runs <b>before every request</b> in this collection.
                </p>
                <textarea
                  rows={10}
                  style={{ width: '100%' }}
                  placeholder={`// runs before each request\npm.environment.set('runStart', String(Date.now()))`}
                  value={collection.preRequestScript ?? ''}
                  onChange={(e) => patch({ preRequestScript: e.target.value })}
                />
              </>
            ) : (
              <>
                <p className="dim" style={{ marginTop: 0 }}>
                  Runs <b>after every request</b> in this collection.
                </p>
                <textarea
                  rows={10}
                  style={{ width: '100%' }}
                  placeholder={`pm.test('no server error', () => {\n  pm.expect(pm.response.code).to.be.below(500)\n})`}
                  value={collection.testScript ?? ''}
                  onChange={(e) => patch({ testScript: e.target.value })}
                />
              </>
            )}
          </div>
        )}

        {tab === 'variables' && (
          <div>
            <p className="dim" style={{ marginTop: 0 }}>
              Collection variables — usable as <span className="mono">{'{{name}}'}</span>. The
              active environment overrides these when keys collide.
            </p>
            <KeyValueEditor
              items={collection.variables ?? []}
              keyPlaceholder="Variable"
              onChange={(variables) => patch({ variables })}
            />
          </div>
        )}
      </div>
    </div>
  )
}
