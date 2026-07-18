import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { executeRequest, type ExecutableRequest } from './http'
import { storage } from './storage'
import * as cdp from './cdp'
import * as ai from './ai'
import { printBanner } from './banner'
import type { Collection, Environment, HistoryEntry, RecordingSession } from '../shared/types'

const MAX_HISTORY = 200

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'PostBox',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  printBanner(app.getVersion())
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void cdp.detach()
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc(): void {
  // ---- HTTP ----
  ipcMain.handle('http:send', (_e, req: ExecutableRequest) => executeRequest(req))

  // ---- Storage ----
  ipcMain.handle('store:load-collections', () => storage.load<Collection[]>('collections.json', []))
  ipcMain.handle('store:save-collections', (_e, data: Collection[]) =>
    storage.save('collections.json', data)
  )
  ipcMain.handle('store:load-environments', () =>
    storage.load<Environment[]>('environments.json', [])
  )
  ipcMain.handle('store:save-environments', (_e, data: Environment[]) =>
    storage.save('environments.json', data)
  )
  ipcMain.handle('store:load-history', () => storage.load<HistoryEntry[]>('history.json', []))
  ipcMain.handle('store:append-history', async (_e, entry: HistoryEntry) => {
    const history = await storage.load<HistoryEntry[]>('history.json', [])
    history.unshift(entry)
    await storage.save('history.json', history.slice(0, MAX_HISTORY))
  })
  ipcMain.handle('store:load-sessions', () => storage.load<RecordingSession[]>('sessions.json', []))
  ipcMain.handle('store:save-sessions', (_e, data: RecordingSession[]) =>
    storage.save('sessions.json', data)
  )

  // ---- CDP ----
  ipcMain.handle('cdp:is-available', () => cdp.isChromeDebuggable())
  ipcMain.handle('cdp:launch-chrome', () => cdp.launchChromeWithDebugPort())
  ipcMain.handle('cdp:list-targets', () => cdp.listTargets())
  ipcMain.handle('cdp:attach', (e, targetId: string) => cdp.attach(targetId, e.sender))
  ipcMain.handle('cdp:detach', () => cdp.detach())
  ipcMain.handle('cdp:attached-target', () => cdp.getAttachedTarget())
  ipcMain.handle('cdp:reload-page', () => cdp.reloadPage())
  ipcMain.handle('cdp:get-records', () => cdp.getRecords())
  ipcMain.handle('cdp:clear-records', () => cdp.clearRecords())
  // ---- AI (RAG over recorded traffic) ----
  ipcMain.handle('ai:set-key', (_e, key: string) => ai.setApiKey(key))
  ipcMain.handle('ai:has-key', () => ai.hasApiKey())
  ipcMain.handle(
    'ai:ask',
    (
      _e,
      question: string,
      sessionId: string | null,
      history: { question: string; answer: string }[]
    ) => ai.ask(question, sessionId, history)
  )

  ipcMain.handle('cdp:get-body', async (_e, requestId: string) => {
    try {
      return await cdp.getResponseBody(requestId)
    } catch (err) {
      return `<< body unavailable: ${err instanceof Error ? err.message : String(err)} >>`
    }
  })
}
