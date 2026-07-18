import { useEffect, useRef, useState } from 'react'
import { THEMES, applyTheme } from '../themes'

interface Props {
  current: string
  onChange: (id: string) => void
}

export default function ThemePicker({ current, onChange }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const active = THEMES.find((t) => t.id === current) ?? THEMES[0]

  const pick = (id: string): void => {
    applyTheme(id)
    onChange(id)
    setOpen(false)
  }

  return (
    <div className="theme-picker" ref={ref}>
      <button className="btn small theme-trigger" onClick={() => setOpen((v) => !v)} title="Theme">
        <span className="theme-swatch" style={{ background: active.swatchBg }}>
          <span className="theme-dot" style={{ background: active.accent }} />
        </span>
        {active.name}
        <span style={{ opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div className="theme-menu">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-option ${t.id === current ? 'active' : ''}`}
              onClick={() => pick(t.id)}
            >
              <span className="theme-swatch lg" style={{ background: t.swatchBg }}>
                <span className="theme-dot" style={{ background: t.accent }} />
              </span>
              <span className="theme-name">{t.name}</span>
              {t.id === current && <span className="theme-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
