import { useState } from 'react'
import type { Environment } from '../../../shared/types'
import { uid } from '../util'
import KeyValueEditor from './KeyValueEditor'
import { textPrompt } from './PromptHost'

interface Props {
  environments: Environment[]
  onChange: (envs: Environment[]) => void
  onClose: () => void
}

export default function EnvironmentManager({
  environments,
  onChange,
  onClose
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(environments[0]?.id ?? null)
  const selected = environments.find((e) => e.id === selectedId) ?? null

  const addEnv = async (): Promise<void> => {
    const name = (await textPrompt('Environment name (e.g. test, prod)'))?.trim()
    if (!name) return
    const env: Environment = { id: uid(), name, variables: [] }
    onChange([...environments, env])
    setSelectedId(env.id)
  }

  const deleteEnv = (id: string): void => {
    onChange(environments.filter((e) => e.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Environments</h3>
        <div className="row">
          <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value || null)}>
            <option value="">— select —</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => void addEnv()}>
            + New
          </button>
          {selected && (
            <button className="btn small" onClick={() => deleteEnv(selected.id)}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        {selected ? (
          <>
            <p className="dim">
              Use variables in requests as <span className="mono">{'{{name}}'}</span>
            </p>
            <KeyValueEditor
              items={selected.variables}
              keyPlaceholder="Variable"
              onChange={(variables) =>
                onChange(environments.map((e) => (e.id === selected.id ? { ...e, variables } : e)))
              }
            />
          </>
        ) : (
          <p className="dim">Create or select an environment to edit its variables.</p>
        )}
      </div>
    </div>
  )
}
