import { useEffect, useRef, useState } from 'react'

// Electron renderers do not implement window.prompt(), so this provides a
// promise-based modal replacement. Mount <PromptHost /> once, call textPrompt().

interface PromptState {
  message: string
  defaultValue: string
  resolve: (value: string | null) => void
}

let showPrompt: ((message: string, defaultValue?: string) => Promise<string | null>) | null = null

export function textPrompt(message: string, defaultValue = ''): Promise<string | null> {
  if (!showPrompt) return Promise.resolve(null)
  return showPrompt(message, defaultValue)
}

export default function PromptHost(): React.JSX.Element | null {
  const [state, setState] = useState<PromptState | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    showPrompt = (message, defaultValue = '') =>
      new Promise<string | null>((resolve) => {
        setValue(defaultValue)
        setState({ message, defaultValue, resolve })
      })
    return () => {
      showPrompt = null
    }
  }, [])

  useEffect(() => {
    if (state) inputRef.current?.focus()
  }, [state])

  if (!state) return null

  const close = (result: string | null): void => {
    state.resolve(result)
    setState(null)
  }

  return (
    <div className="modal-overlay" onClick={() => close(null)}>
      <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{state.message}</p>
        <input
          ref={inputRef}
          type="text"
          style={{ width: '100%' }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') close(value)
            if (e.key === 'Escape') close(null)
          }}
        />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={() => close(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => close(value)}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
