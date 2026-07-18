import { useEffect, useRef, useState } from 'react'

interface Turn {
  question: string
  answer: string
  sources: { index: number; method: string; url: string; status?: number }[]
  error?: string
}

interface Props {
  /** null = live capture; otherwise the saved-session id being viewed */
  sessionId: string | null
  requestCount: number
  onClose: () => void
}

export default function AskAI({ sessionId, requestCount, onClose }: Props): React.JSX.Element {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.aiHasKey().then(setHasKey)
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, busy])

  const saveKey = async (): Promise<void> => {
    if (!keyInput.trim()) return
    await window.api.aiSetKey(keyInput.trim())
    setKeyInput('')
    setHasKey(true)
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
        {
          question: q,
          answer: '',
          sources: [],
          error: e instanceof Error ? e.message : String(e)
        }
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="askai">
      <div className="askai-header">
        <span style={{ fontWeight: 700 }}>🤖 Ask AI about this traffic</span>
        <span className="dim" style={{ fontSize: 12 }}>
          {sessionId ? 'saved session' : 'live capture'} · {requestCount} requests
        </span>
        <span className="spacer" />
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </div>

      {hasKey === false && (
        <div className="askai-keysetup">
          <p className="dim" style={{ marginTop: 0 }}>
            Enter your Anthropic API key (from <span className="mono">console.anthropic.com</span>).
            Stored locally in <span className="mono">data/settings.json</span> — never leaves this
            machine except to call the API.
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
              Save key
            </button>
          </div>
        </div>
      )}

      {hasKey && (
        <>
          <div className="askai-turns" ref={scrollRef}>
            {turns.length === 0 && (
              <div className="empty-note">
                Ask about the recorded traffic — e.g. “where does{' '}
                <span className="mono">deviceUserAgentId</span> come from?”, “which requests set
                cookies?”, “why did the search call fail?”
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
              placeholder="Where does this parameter come from?"
              value={question}
              disabled={busy}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void askQuestion()
              }}
            />
            <button
              className="btn primary"
              disabled={busy || !question.trim()}
              onClick={() => void askQuestion()}
            >
              {busy ? '…' : 'Ask'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
