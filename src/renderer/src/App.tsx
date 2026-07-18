import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApiRequest,
  ApiResponse,
  Collection,
  Environment,
  HistoryEntry,
  RecordingSession
} from '../../shared/types'
import Sidebar from './components/Sidebar'
import RequestBuilder from './components/RequestBuilder'
import ResponseViewer from './components/ResponseViewer'
import Recorder from './components/Recorder'
import EnvironmentManager from './components/EnvironmentManager'
import PromptHost, { textPrompt } from './components/PromptHost'
import { buildExecutable, emptyRequest, uid } from './util'

type View = 'client' | 'recorder'

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>('client')
  const [collections, setCollections] = useState<Collection[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [activeEnvId, setActiveEnvId] = useState<string>('')
  const [showEnvManager, setShowEnvManager] = useState(false)
  const [request, setRequest] = useState<ApiRequest>(emptyRequest())
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [sending, setSending] = useState(false)
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

  const send = async (): Promise<void> => {
    setSending(true)
    setResponse(null)
    try {
      const exec = buildExecutable(request, activeEnv)
      const res = await window.api.sendRequest(exec)
      setResponse(res)
      const entry: HistoryEntry = {
        id: uid(),
        timestamp: Date.now(),
        request: structuredClone(request),
        status: res.status,
        timeMs: res.timeMs
      }
      setHistory((h) => [entry, ...h].slice(0, 200))
      void window.api.appendHistory(entry)
    } catch (e) {
      setResponse({
        status: 0,
        statusText: '',
        headers: {},
        body: '',
        bodyTruncated: false,
        timeMs: 0,
        sizeBytes: 0,
        error: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSending(false)
    }
  }

  const saveRequest = async (): Promise<void> => {
    if (collections.length === 0) {
      const name = (
        await textPrompt('No collections yet. Name a new collection to save into:')
      )?.trim()
      if (!name) return
      persistCollections([
        { id: uid(), name, folders: [], requests: [structuredClone(request)] }
      ])
      return
    }
    const names = collections.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
    const pick = await textPrompt(
      `Save "${request.name}" to which collection?\n${names}\n\nEnter number:`,
      '1'
    )
    const idx = pick ? parseInt(pick, 10) - 1 : -1
    if (idx < 0 || idx >= collections.length) return
    persistCollections(
      collections.map((c, i) => {
        if (i !== idx) return c
        const existing = c.requests.findIndex((r) => r.id === request.id)
        const reqs =
          existing >= 0
            ? c.requests.map((r) => (r.id === request.id ? structuredClone(request) : r))
            : [...c.requests, structuredClone(request)]
        return { ...c, requests: reqs }
      })
    )
  }

  const openRequest = (req: ApiRequest): void => {
    setRequest(structuredClone(req))
    setResponse(null)
    setView('client')
  }

  const saveSession = async (session: RecordingSession): Promise<void> => {
    const sessions = await window.api.loadSessions()
    await window.api.saveSessions([session, ...sessions])
    alert(`Session "${session.name}" saved (${session.requests.length} requests).`)
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
        <button className="btn small" onClick={() => openRequest(emptyRequest())}>
          + New Request
        </button>
      </div>

      <div className="body">
        {view === 'client' && (
          <>
            <Sidebar
              collections={collections}
              history={history}
              activeRequestId={request.id}
              onCollectionsChange={persistCollections}
              onOpenRequest={openRequest}
            />
            <div className="main">
              <RequestBuilder
                request={request}
                sending={sending}
                onChange={setRequest}
                onSend={() => void send()}
                onSave={() => void saveRequest()}
              />
              <ResponseViewer response={response} />
            </div>
          </>
        )}
        {view === 'recorder' && (
          <div className="main">
            <Recorder onSendToClient={openRequest} onSaveSession={(s) => void saveSession(s)} />
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
    </div>
  )
}
