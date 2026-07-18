import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApiRequest,
  ApiResponse,
  Collection,
  Environment,
  HistoryEntry
} from '../../shared/types'
import Sidebar from './components/Sidebar'
import RequestBuilder from './components/RequestBuilder'
import ResponseViewer from './components/ResponseViewer'
import Recorder from './components/Recorder'
import EnvironmentManager from './components/EnvironmentManager'
import RunnerModal from './components/RunnerModal'
import PromptHost, { textPrompt } from './components/PromptHost'
import ThemePicker from './components/ThemePicker'
import { buildExecutable, emptyRequest, uid } from './util'
import { runTestScript, type ScriptOutcome } from './lib/scripts'
import { loadTheme } from './themes'

type View = 'client' | 'recorder'

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>('client')
  const [collections, setCollections] = useState<Collection[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [activeEnvId, setActiveEnvId] = useState<string>('')
  const [showEnvManager, setShowEnvManager] = useState(false)
  const [runningCollection, setRunningCollection] = useState<Collection | null>(null)
  const [theme, setTheme] = useState<string>(() => loadTheme())

  const [tabs, setTabs] = useState<ApiRequest[]>(() => [emptyRequest()])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)
  const [responses, setResponses] = useState<Record<string, ApiResponse | null>>({})
  const [testOutcomes, setTestOutcomes] = useState<Record<string, ScriptOutcome | null>>({})
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const loaded = useRef(false)

  useEffect(() => {
    void (async () => {
      const [cols, hist, envs] = await Promise.all([
        window.api.loadCollections(),
        window.api.loadHistory(),
        window.api.loadEnvironments()
      ])
      setCollections(cols)
      setHistory(hist)
      setEnvironments(envs)
      const savedEnv = localStorage.getItem('activeEnvId')
      if (savedEnv && envs.some((e) => e.id === savedEnv)) setActiveEnvId(savedEnv)
      loaded.current = true
    })()
  }, [])

  const persistCollections = useCallback((cols: Collection[]): void => {
    setCollections(cols)
    if (loaded.current) void window.api.saveCollections(cols)
  }, [])

  const persistEnvironments = useCallback((envs: Environment[]): void => {
    setEnvironments(envs)
    if (loaded.current) void window.api.saveEnvironments(envs)
  }, [])

  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  const updateTab = (req: ApiRequest): void => {
    setTabs((prev) => prev.map((t) => (t.id === req.id ? req : t)))
  }

  const openRequest = (req: ApiRequest): void => {
    const clone = structuredClone(req)
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === clone.id)
      if (existing) return prev.map((t) => (t.id === clone.id ? clone : t))
      return [...prev, clone]
    })
    setActiveTabId(clone.id)
    setView('client')
  }

  const newTab = (): void => {
    const req = emptyRequest()
    setTabs((prev) => [...prev, req])
    setActiveTabId(req.id)
  }

  const closeTab = (id: string): void => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (next.length === 0) {
        const fresh = emptyRequest()
        setActiveTabId(fresh.id)
        return [fresh]
      }
      if (id === activeTabId) setActiveTabId(next[Math.max(0, next.length - 1)].id)
      return next
    })
    setResponses((prev) => ({ ...prev, [id]: null }))
    setTestOutcomes((prev) => ({ ...prev, [id]: null }))
  }

  const send = async (req: ApiRequest): Promise<void> => {
    setSending((s) => ({ ...s, [req.id]: true }))
    setResponses((r) => ({ ...r, [req.id]: null }))
    setTestOutcomes((t) => ({ ...t, [req.id]: null }))
    try {
      const exec = buildExecutable(req, activeEnv)
      const res = await window.api.sendRequest(exec)
      setResponses((r) => ({ ...r, [req.id]: res }))

      if (req.testScript?.trim() && !res.error) {
        const envVars: Record<string, string> = {}
        for (const v of activeEnv?.variables ?? []) {
          if (v.enabled) envVars[v.key] = v.value
        }
        const outcome = runTestScript(req.testScript, res, envVars)
        setTestOutcomes((t) => ({ ...t, [req.id]: outcome }))
        if (activeEnv && Object.keys(outcome.envUpdates).length > 0) {
          const merged = { ...activeEnv }
          for (const [k, v] of Object.entries(outcome.envUpdates)) {
            const existing = merged.variables.find((kv) => kv.key === k)
            merged.variables = existing
              ? merged.variables.map((kv) => (kv.key === k ? { ...kv, value: v } : kv))
              : [...merged.variables, { key: k, value: v, enabled: true }]
          }
          persistEnvironments(environments.map((e) => (e.id === merged.id ? merged : e)))
        }
      }

      const entry: HistoryEntry = {
        id: uid(),
        timestamp: Date.now(),
        request: structuredClone(req),
        status: res.status,
        timeMs: res.timeMs
      }
      setHistory((h) => [entry, ...h].slice(0, 200))
      void window.api.appendHistory(entry)
    } catch (e) {
      setResponses((r) => ({
        ...r,
        [req.id]: {
          status: 0,
          statusText: '',
          headers: {},
          body: '',
          bodyTruncated: false,
          timeMs: 0,
          sizeBytes: 0,
          error: e instanceof Error ? e.message : String(e)
        }
      }))
    } finally {
      setSending((s) => ({ ...s, [req.id]: false }))
    }
  }

  const saveRequest = async (req: ApiRequest): Promise<void> => {
    if (collections.length === 0) {
      const name = (
        await textPrompt('No collections yet. Name a new collection to save into:')
      )?.trim()
      if (!name) return
      persistCollections([{ id: uid(), name, folders: [], requests: [structuredClone(req)] }])
      return
    }
    const names = collections.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
    const pick = await textPrompt(
      `Save "${req.name}" to which collection?\n${names}\n\nEnter number:`,
      '1'
    )
    const idx = pick ? parseInt(pick, 10) - 1 : -1
    if (idx < 0 || idx >= collections.length) return
    persistCollections(
      collections.map((c, i) => {
        if (i !== idx) return c
        const inTop = c.requests.some((r) => r.id === req.id)
        const inFolder = c.folders.find((f) => f.requests.some((r) => r.id === req.id))
        if (inTop) {
          return {
            ...c,
            requests: c.requests.map((r) => (r.id === req.id ? structuredClone(req) : r))
          }
        }
        if (inFolder) {
          return {
            ...c,
            folders: c.folders.map((f) => ({
              ...f,
              requests: f.requests.map((r) => (r.id === req.id ? structuredClone(req) : r))
            }))
          }
        }
        return { ...c, requests: [...c.requests, structuredClone(req)] }
      })
    )
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="logo">📮 PostBox</span>
        <div className="view-switch">
          <button className={view === 'client' ? 'active' : ''} onClick={() => setView('client')}>
            API Client
          </button>
          <button
            className={view === 'recorder' ? 'active' : ''}
            onClick={() => setView('recorder')}
          >
            Network Recorder
          </button>
        </div>
        <span className="spacer" />
        <select
          value={activeEnvId}
          onChange={(e) => {
            setActiveEnvId(e.target.value)
            localStorage.setItem('activeEnvId', e.target.value)
          }}
          title="Active environment"
        >
          <option value="">No environment</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
        <button className="btn small" onClick={() => setShowEnvManager(true)}>
          Manage
        </button>
        <ThemePicker current={theme} onChange={setTheme} />
      </div>

      <div className="body">
        {view === 'client' && (
          <div className="view" key="client">
            <Sidebar
              collections={collections}
              history={history}
              activeRequestId={activeTab?.id ?? null}
              onCollectionsChange={persistCollections}
              onOpenRequest={openRequest}
              onRunCollection={setRunningCollection}
            />
            <div className="main">
              <div className="req-tabs">
                {tabs.map((t) => (
                  <div
                    key={t.id}
                    className={`req-tab ${t.id === activeTab?.id ? 'active' : ''}`}
                    onClick={() => setActiveTabId(t.id)}
                    title={t.url || t.name}
                  >
                    <span className={`m-${t.method}`} style={{ fontSize: 10, fontWeight: 800 }}>
                      {t.method}
                    </span>
                    <span className="req-tab-name">{t.name || 'Untitled'}</span>
                    <button
                      className="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(t.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button className="icon req-tab-add" title="New tab" onClick={newTab}>
                  +
                </button>
              </div>
              {activeTab && (
                <>
                  <RequestBuilder
                    request={activeTab}
                    sending={!!sending[activeTab.id]}
                    onChange={updateTab}
                    onSend={() => void send(activeTab)}
                    onSave={() => void saveRequest(activeTab)}
                  />
                  <ResponseViewer
                    response={responses[activeTab.id] ?? null}
                    testOutcome={testOutcomes[activeTab.id] ?? null}
                  />
                </>
              )}
            </div>
          </div>
        )}
        {view === 'recorder' && (
          <div className="view" key="recorder">
            <div className="main">
              <Recorder onSendToClient={openRequest} />
            </div>
          </div>
        )}
      </div>

      <PromptHost />
      {showEnvManager && (
        <EnvironmentManager
          environments={environments}
          onChange={persistEnvironments}
          onClose={() => setShowEnvManager(false)}
        />
      )}
      {runningCollection && (
        <RunnerModal
          collection={runningCollection}
          env={activeEnv}
          onClose={() => setRunningCollection(null)}
        />
      )}
    </div>
  )
}
