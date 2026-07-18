import type {
  ApiResponse,
  CdpTarget,
  Collection,
  Environment,
  HistoryEntry,
  RecordedRequest,
  RecordingSession
} from '../shared/types'

export interface PostboxApi {
  sendRequest(req: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }): Promise<ApiResponse>

  loadCollections(): Promise<Collection[]>
  saveCollections(data: Collection[]): Promise<void>
  loadEnvironments(): Promise<Environment[]>
  saveEnvironments(data: Environment[]): Promise<void>
  loadHistory(): Promise<HistoryEntry[]>
  appendHistory(entry: HistoryEntry): Promise<void>
  loadSessions(): Promise<RecordingSession[]>
  saveSessions(data: RecordingSession[]): Promise<void>

  cdpIsAvailable(): Promise<boolean>
  cdpLaunchChrome(): Promise<void>
  cdpListTargets(): Promise<CdpTarget[]>
  cdpAttach(targetId: string): Promise<void>
  cdpDetach(): Promise<void>
  cdpReloadPage(): Promise<void>
  cdpGetRecords(): Promise<RecordedRequest[]>
  cdpClearRecords(): Promise<void>
  cdpGetBody(requestId: string): Promise<string>

  onCdpRequestUpdate(cb: (rec: RecordedRequest) => void): () => void
  onCdpDetached(cb: () => void): () => void
}

declare global {
  interface Window {
    api: PostboxApi
  }
}
