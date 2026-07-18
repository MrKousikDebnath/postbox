import { useMemo, useRef, useState } from 'react'
import type { ApiRequest, Collection, Folder, HistoryEntry } from '../../../shared/types'
import { statusClass, uid } from '../util'
import { textPrompt } from './PromptHost'
import { importPostmanCollection, exportPostmanCollection } from '../lib/postman'
import { parseCurl } from '../lib/curl'

interface Props {
  collections: Collection[]
  history: HistoryEntry[]
  activeRequestId: string | null
  onCollectionsChange: (c: Collection[]) => void
  onOpenRequest: (req: ApiRequest) => void
  onRunCollection: (col: Collection) => void
}

type SortMode = 'manual' | 'name' | 'method'

export default function Sidebar({
  collections,
  history,
  activeRequestId,
  onCollectionsChange,
  onOpenRequest,
  onRunCollection
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<'collections' | 'history'>('collections')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortMode>('manual')
  const [search, setSearch] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const toggleCollapse = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sortRequests = (reqs: ApiRequest[]): ApiRequest[] => {
    if (sort === 'name') return [...reqs].sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'method') return [...reqs].sort((a, b) => a.method.localeCompare(b.method))
    return reqs
  }

  const matches = (r: ApiRequest): boolean => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.name.toLowerCase().includes(q) ||
      r.url.toLowerCase().includes(q) ||
      r.method.toLowerCase().includes(q)
    )
  }

  // ---- collection ops ----
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

  const addFolder = async (colId: string): Promise<void> => {
    const name = (await textPrompt('Folder name'))?.trim()
    if (!name) return
    onCollectionsChange(
      collections.map((c) =>
        c.id === colId ? { ...c, folders: [...c.folders, { id: uid(), name, requests: [] }] } : c
      )
    )
  }

  const renameFolder = async (colId: string, folderId: string): Promise<void> => {
    const folder = collections.find((c) => c.id === colId)?.folders.find((f) => f.id === folderId)
    const name = (await textPrompt('Rename folder', folder?.name ?? ''))?.trim()
    if (!name) return
    onCollectionsChange(
      collections.map((c) =>
        c.id === colId
          ? { ...c, folders: c.folders.map((f) => (f.id === folderId ? { ...f, name } : f)) }
          : c
      )
    )
  }

  const deleteFolder = (colId: string, folderId: string): void => {
    const folder = collections.find((c) => c.id === colId)?.folders.find((f) => f.id === folderId)
    if (!confirm(`Delete folder "${folder?.name}" and its requests?`)) return
    onCollectionsChange(
      collections.map((c) =>
        c.id === colId ? { ...c, folders: c.folders.filter((f) => f.id !== folderId) } : c
      )
    )
  }

  // ---- request ops ----
  const updateRequests = (
    colId: string,
    folderId: string | null,
    fn: (reqs: ApiRequest[]) => ApiRequest[]
  ): void => {
    onCollectionsChange(
      collections.map((c) => {
        if (c.id !== colId) return c
        if (folderId === null) return { ...c, requests: fn(c.requests) }
        return {
          ...c,
          folders: c.folders.map((f) =>
            f.id === folderId ? { ...f, requests: fn(f.requests) } : f
          )
        }
      })
    )
  }

  const deleteRequest = (colId: string, folderId: string | null, reqId: string): void => {
    updateRequests(colId, folderId, (reqs) => reqs.filter((r) => r.id !== reqId))
  }

  const duplicateRequest = (colId: string, folderId: string | null, req: ApiRequest): void => {
    const copy = { ...structuredClone(req), id: uid(), name: `${req.name} copy` }
    updateRequests(colId, folderId, (reqs) => [...reqs, copy])
  }

  const renameRequest = async (
    colId: string,
    folderId: string | null,
    req: ApiRequest
  ): Promise<void> => {
    const name = (await textPrompt('Rename request', req.name))?.trim()
    if (!name) return
    updateRequests(colId, folderId, (reqs) =>
      reqs.map((r) => (r.id === req.id ? { ...r, name } : r))
    )
  }

  // ---- import / export ----
  const importFile = (): void => fileInput.current?.click()

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    try {
      const col = importPostmanCollection(JSON.parse(text))
      if (!col) {
        alert('Not a recognizable Postman collection (v2.x).')
        return
      }
      onCollectionsChange([...collections, col])
    } catch {
      alert('Could not parse that file as JSON.')
    }
  }

  const importCurl = async (): Promise<void> => {
    const cmd = await textPrompt('Paste a curl command')
    if (!cmd?.trim()) return
    const parsed = parseCurl(cmd)
    if (!parsed) {
      alert('Could not parse that curl command.')
      return
    }
    onOpenRequest({ ...parsed, id: uid() })
  }

  const exportCollection = (col: Collection): void => {
    const data = JSON.stringify(exportPostmanCollection(col), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${col.name.replace(/[^\w-]+/g, '_')}.postman_collection.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const requestRow = (
    req: ApiRequest,
    colId: string,
    folderId: string | null
  ): React.JSX.Element => (
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
          title="Rename"
          onClick={(e) => {
            e.stopPropagation()
            void renameRequest(colId, folderId, req)
          }}
        >
          ✎
        </button>
        <button
          className="icon"
          title="Duplicate"
          onClick={(e) => {
            e.stopPropagation()
            duplicateRequest(colId, folderId, req)
          }}
        >
          ⧉
        </button>
        <button
          className="icon"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation()
            deleteRequest(colId, folderId, req.id)
          }}
        >
          ✕
        </button>
      </span>
    </div>
  )

  const folderBlock = (col: Collection, folder: Folder): React.JSX.Element => {
    const reqs = sortRequests(folder.requests.filter(matches))
    return (
      <div className="tree-group" key={folder.id}>
        <div className="tree-item" onClick={() => toggleCollapse(folder.id)}>
          <span className="caret">{collapsed.has(folder.id) ? '▸' : '▾'}</span>
          <span className="name">🗂 {folder.name}</span>
          <span className="actions">
            <button
              className="icon"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation()
                void renameFolder(col.id, folder.id)
              }}
            >
              ✎
            </button>
            <button
              className="icon"
              title="Delete folder"
              onClick={(e) => {
                e.stopPropagation()
                deleteFolder(col.id, folder.id)
              }}
            >
              ✕
            </button>
          </span>
        </div>
        {!collapsed.has(folder.id) && (
          <div className="tree-children">{reqs.map((r) => requestRow(r, col.id, folder.id))}</div>
        )}
      </div>
    )
  }

  const visibleCollections = useMemo(() => collections, [collections])

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
              + New
            </button>
            <button
              className="btn small"
              title="Import Postman collection JSON"
              onClick={importFile}
            >
              ⇪ Import
            </button>
            <button
              className="btn small"
              title="Import a curl command"
              onClick={() => void importCurl()}
            >
              ⌘ cURL
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => void onFilePicked(e)}
            />
          </div>
          <div className="sidebar-filter">
            <input
              type="text"
              placeholder="Search requests…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} title="Sort">
              <option value="manual">Sort: manual</option>
              <option value="name">Sort: name</option>
              <option value="method">Sort: method</option>
            </select>
          </div>
          <div className="sidebar-body fade-fast" key="collections">
            {visibleCollections.length === 0 && (
              <div className="empty-note">
                No collections yet. Create one, or import a Postman collection.
              </div>
            )}
            {visibleCollections.map((col) => (
              <div className="tree-group" key={col.id}>
                <div className="tree-item" onClick={() => toggleCollapse(col.id)}>
                  <span className="caret">{collapsed.has(col.id) ? '▸' : '▾'}</span>
                  <span className="name">📁 {col.name}</span>
                  <span className="actions">
                    <button
                      className="icon"
                      title="Run collection"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRunCollection(col)
                      }}
                    >
                      ▶
                    </button>
                    <button
                      className="icon"
                      title="New folder"
                      onClick={(e) => {
                        e.stopPropagation()
                        void addFolder(col.id)
                      }}
                    >
                      🗂
                    </button>
                    <button
                      className="icon"
                      title="Export (Postman v2.1)"
                      onClick={(e) => {
                        e.stopPropagation()
                        exportCollection(col)
                      }}
                    >
                      ⇩
                    </button>
                    <button
                      className="icon"
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation()
                        void renameCollection(col.id)
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="icon"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteCollection(col.id)
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {!collapsed.has(col.id) && (
                  <div className="tree-children">
                    {col.folders.map((f) => folderBlock(col, f))}
                    {sortRequests(col.requests.filter(matches)).map((r) =>
                      requestRow(r, col.id, null)
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="sidebar-body fade-fast" key="history">
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
