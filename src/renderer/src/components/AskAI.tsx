import { useEffect, useRef, useState } from 'react'

type Backend = 'local' | 'ollama' | 'anthropic'

interface Turn {
  question: string
  answer: string
  sources: { index: number; method: string; url: string; status?: number }[]
  error?: string
}

interface Props {
  sessionId: string | null
  requestCount: number
  onClose: () => void
}

export default function AskAI({ sessionId, requestCount, onClose }: Props): React.JSX.Element {
  const [backend, setBackend] = useState<Backend>('local')
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaModel, setOllamaModel] = useState('')
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.aiSettings().then((s) => {
      setBackend(s.backend)
      setHasKey(s.hasAnthropicKey)
      setOllamaModel(s.ollamaModel)
    })
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, busy])

  const chooseBackend = async (b: Backend): Promise<void> => {
    setBackend(b)
    await window.api.aiSetBackend(b)
    if (b === 'ollama') {
      const models = await window.api.aiListOllama()
      setOllamaModels(models)
      if (!ollamaModel && models.length > 0) {
        setOllamaModel(models[0])
        await window.api.aiSetOllamaModel(models[0])
      }
    }
  }

  const saveKey = async (): Promise<void> => {
    if (!keyInput.trim()) return
    await window.api.aiSetKey(keyInput.trim())
    setKeyInput('')
    setHasKey(true)
  }

  const pickModel = async (model: string): Promise<void> => {
    setOllamaModel(model)
    await window.api.aiSetOllamaModel(model)
  }

  const askQuestion = async (): Promise<void> => {
    const q = question.trim()
    if (!q || busy) return
    setQuestion('')
    setBusy(true)
    try {
      const history = turns
        .filter((t) => !t.error)
        .map((t) => ({ question: t.question, answer: t.answer }))
      const result = await window.api.aiAsk(q, sessionId, history)
      setTurns((prev) => [
        ...prev,
        { question: q, answer: result.answer, sources: result.sources, error: result.error }
      ])
    } catch (e) {
      setTurns((prev) => [
        ...prev,
        { question: q, answer: '', sources: [], error: e instanceof Error ? e.message : String(e) }
      ])
    } finally {
      setBusy(false)
    }
  }

  const needsSetup =
    (backend === 'anthropic' && !hasKey) ||
    (backend === 'ollama' && ollamaModels.length === 0 && !ollamaModel)

  return (
    <div className="askai">
      <div className="askai-header">
        <span style={{ fontWeight: 700 }}>🤖 Ask AI</span>
        <span className="dim" style={{ fontSize: 12 }}>
          {sessionId ? 'saved session' : 'live'} · {requestCount} reqs
        </span>
        <span className="spacer" />
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="askai-backends">
        {(
          [
            ['local', 'Local (offline)'],
            ['ollama', 'Ollama'],
            ['anthropic', 'Claude API']
          ] as [Backend, string][]
        ).map(([b, label]) => (
          <button
            key={b}
            className={`chip ${backend === b ? 'active' : ''}`}
            onClick={() => void chooseBackend(b)}
          >
            {label}
          </button>
        ))}
      </div>

      {backend === 'anthropic' && !hasKey && (
        <div className="askai-keysetup">
          <p className="dim" style={{ marginTop: 0 }}>
            Paid. Anthropic API key (from <span className="mono">console.anthropic.com</span>),
            stored locally in <span className="mono">data/settings.json</span>.
          </p>
          <div className="row">
            <input
              type="password"
              style={{ flex: 1 }}
              placeholder="sk-ant-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveKey()
              }}
            />
            <button className="btn primary" onClick={() => void saveKey()}>
              Save
            </button>
          </div>
        </div>
      )}

      {backend === 'ollama' && (
        <div className="askai-keysetup">
          {ollamaModels.length === 0 ? (
            <p className="dim" style={{ marginTop: 0 }}>
              Free local LLM. No Ollama detected at <span className="mono">localhost:11434</span> —
              install from <span className="mono">ollama.com</span>, run{' '}
              <span className="mono">ollama pull llama3.1</span>, then reselect Ollama.
            </p>
          ) : (
            <div className="row">
              <span className="dim">Model</span>
              <select
                style={{ flex: 1 }}
                value={ollamaModel}
                onChange={(e) => void pickModel(e.target.value)}
              >
                {ollamaModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="askai-turns" ref={scrollRef}>
        {turns.length === 0 && (
          <div className="empty-note">
            {backend === 'local' &&
              'Offline analysis. Ask where a value comes from — e.g. “where does deviceUserAgentId come from?”. Put exact keys in quotes for best results.'}
            {backend === 'ollama' &&
              'Local LLM via Ollama. Ask anything about the recorded traffic in plain language.'}
            {backend === 'anthropic' &&
              'Claude API (paid). Ask anything about the recorded traffic in plain language.'}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="askai-turn">
            <div className="askai-q">{t.question}</div>
            {t.error ? (
              <div className="error-banner" style={{ margin: '6px 0 0' }}>
                {t.error}
              </div>
            ) : (
              <div className="askai-a">
                {t.answer}
                {t.sources.length > 0 && (
                  <div className="askai-sources">
                    {t.sources.map((s) => (
                      <div key={s.index} className="askai-source" title={s.url}>
                        <span className="dim">[{s.index}]</span>{' '}
                        <span className={`m-${s.method}`} style={{ fontWeight: 700 }}>
                          {s.method}
                        </span>{' '}
                        <span className="mono">{s.url}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="dim askai-busy">Analyzing {requestCount} requests…</div>}
      </div>

      <div className="askai-input">
        <input
          type="text"
          style={{ flex: 1 }}
          placeholder={needsSetup ? 'Finish setup above first…' : 'Ask about the traffic…'}
          value={question}
          disabled={busy || needsSetup}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void askQuestion()
          }}
        />
        <button
          className="btn primary"
          disabled={busy || needsSetup || !question.trim()}
          onClick={() => void askQuestion()}
        >
          {busy ? '…' : 'Ask'}
        </button>
      </div>
    </div>
  )
}
