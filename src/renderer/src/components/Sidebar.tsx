import { useState } from 'react'
import type { ApiRequest, Collection, HistoryEntry } from '../../../shared/types'
import { statusClass, uid } from '../util'
import { textPrompt } from './PromptHost'

interface Props {
  collections: Collection[]
  history: HistoryEntry[]
  activeRequestId: string | null
  onCollectionsChange: (c: Collection[]) => void
  onOpenRequest: (req: ApiRequest) => void
}

export default function Sidebar({
  collections,
  history,
  activeRequestId,
  onCollectionsChange,
  onOpenRequest
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<'collections' | 'history'>('collections')

  const addCollection = async (): Promise<void> => {
    const name = (await textPrompt('Collection name'))?.trim()
    if (!name) return
    onCollectionsChange([...collections, { id: uid(), name, folders: [], requests: [] }])
  }

  const renameCollection = async (id: string): Promise<void> => {
    const col = collections.find((c) => c.id === id)
    const name = (await textPrompt('Rename collection', col?.name ?? ''))?.trim()
    if (!name) return
    onCollectionsChange(collections.map((c) => (c.id === id ? { ...c, name } : c)))
  }

  const deleteCollection = (id: string): void => {
    const col = collections.find((c) => c.id === id)
    if (!confirm(`Delete collection "${col?.name}" and all its requests?`)) return
    onCollectionsChange(collections.filter((c) => c.id !== id))
  }

  const deleteRequest = (colId: string, reqId: string): void => {
    onCollectionsChange(
      collections.map((c) =>
        c.id === colId ? { ...c, requests: c.requests.filter((r) => r.id !== reqId) } : c
      )
    )
  }

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={tab === 'collections' ? 'active' : ''}
          onClick={() => setTab('collections')}
        >
          Collections
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          History
        </button>
      </div>

      {tab === 'collections' && (
        <>
          <div className="sidebar-actions">
            <button className="btn small" onClick={() => void addCollection()}>
              + New Collection
            </button>
          </div>
          <div className="sidebar-body">
            {collections.length === 0 && (
              <div className="empty-note">
                No collections yet. Create one, then save requests into it.
              </div>
            )}
            {collections.map((col) => (
              <div className="tree-group" key={col.id}>
                <div className="tree-item">
                  <span className="name">📁 {col.name}</span>
                  <span className="actions">
                    <button
                      className="icon"
                      title="Rename"
                      onClick={() => void renameCollection(col.id)}
                    >
                      ✎
                    </button>
                    <button
                      className="icon"
                      title="Delete"
                      onClick={() => deleteCollection(col.id)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <div className="tree-children">
                  {col.requests.map((req) => (
                    <div
                      key={req.id}
                      className={`tree-item ${req.id === activeRequestId ? 'selected' : ''}`}
                      onClick={() => onOpenRequest(req)}
                    >
                      <span className={`method-tag m-${req.method}`}>{req.method}</span>
                      <span className="name">{req.name}</span>
                      <span className="actions">
                        <button
                          className="icon"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteRequest(col.id, req.id)
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="sidebar-body">
          {history.length === 0 && <div className="empty-note">No requests sent yet.</div>}
          {history.map((h) => (
            <div key={h.id} className="tree-item" onClick={() => onOpenRequest(h.request)}>
              <span className={`method-tag m-${h.request.method}`}>{h.request.method}</span>
              <span className="name mono" title={h.request.url}>
                {h.request.url.replace(/^https?:\/\//, '')}
              </span>
              <span className={`hist-meta ${statusClass(h.status)}`}>{h.status || 'ERR'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
