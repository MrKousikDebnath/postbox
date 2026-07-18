import type { KeyValue } from '../../../shared/types'

interface Props {
  items: KeyValue[]
  onChange: (items: KeyValue[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}

export default function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value'
}: Props): React.JSX.Element {
  const update = (i: number, patch: Partial<KeyValue>): void => {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    onChange(next)
  }

  const remove = (i: number): void => onChange(items.filter((_, idx) => idx !== i))
  const add = (): void => onChange([...items, { key: '', value: '', enabled: true }])

  return (
    <div>
      <table className="kv-table">
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="kv-check">
                <input
                  type="checkbox"
                  checked={it.enabled}
                  onChange={(e) => update(i, { enabled: e.target.checked })}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={it.key}
                  placeholder={keyPlaceholder}
                  onChange={(e) => update(i, { key: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={it.value}
                  placeholder={valuePlaceholder}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              </td>
              <td className="kv-del">
                <button className="icon" title="Remove" onClick={() => remove(i)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn small" style={{ marginTop: 6 }} onClick={add}>
        + Add
      </button>
    </div>
  )
}
