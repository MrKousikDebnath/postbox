import { contextBridge, ipcRenderer } from 'electron'

const api = {
  sendRequest: (req: unknown) => ipcRenderer.invoke('http:send', req),

  loadCollections: () => ipcRenderer.invoke('store:load-collections'),
  saveCollections: (data: unknown) => ipcRenderer.invoke('store:save-collections', data),
  loadEnvironments: () => ipcRenderer.invoke('store:load-environments'),
  saveEnvironments: (data: unknown) => ipcRenderer.invoke('store:save-environments', data),
  loadHistory: () => ipcRenderer.invoke('store:load-history'),
  appendHistory: (entry: unknown) => ipcRenderer.invoke('store:append-history', entry),
  loadSessions: () => ipcRenderer.invoke('store:load-sessions'),
  saveSessions: (data: unknown) => ipcRenderer.invoke('store:save-sessions', data),

  cdpIsAvailable: () => ipcRenderer.invoke('cdp:is-available'),
  cdpLaunchChrome: () => ipcRenderer.invoke('cdp:launch-chrome'),
  cdpListTargets: () => ipcRenderer.invoke('cdp:list-targets'),
  cdpAttach: (targetId: string) => ipcRenderer.invoke('cdp:attach', targetId),
  cdpDetach: () => ipcRenderer.invoke('cdp:detach'),
  cdpAttachedTarget: () => ipcRenderer.invoke('cdp:attached-target'),
  cdpReloadPage: () => ipcRenderer.invoke('cdp:reload-page'),
  cdpGetRecords: () => ipcRenderer.invoke('cdp:get-records'),
  cdpClearRecords: () => ipcRenderer.invoke('cdp:clear-records'),
  cdpGetBody: (requestId: string) => ipcRenderer.invoke('cdp:get-body', requestId),

  aiSettings: () => ipcRenderer.invoke('ai:settings'),
  aiSetBackend: (backend: string) => ipcRenderer.invoke('ai:set-backend', backend),
  aiSetKey: (key: string) => ipcRenderer.invoke('ai:set-key', key),
  aiSetOllamaModel: (model: string) => ipcRenderer.invoke('ai:set-ollama-model', model),
  aiListOllama: () => ipcRenderer.invoke('ai:list-ollama'),
  aiAsk: (question: string, sessionId: string | null, history: unknown[]) =>
    ipcRenderer.invoke('ai:ask', question, sessionId, history),

  onCdpRequestUpdate: (cb: (rec: unknown) => void) => {
    const listener = (_e: unknown, rec: unknown): void => cb(rec)
    ipcRenderer.on('cdp:request-update', listener)
    return () => ipcRenderer.removeListener('cdp:request-update', listener)
  },
  onCdpDetached: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('cdp:detached', listener)
    return () => ipcRenderer.removeListener('cdp:detached', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
