# Copilot instructions for PostBox

PostBox is a desktop API client + Chrome network recorder: Electron 31, React 18,
TypeScript, electron-vite. Node 20 required (`.nvmrc`).

## Build and verify

```bash
npm ci
npm run typecheck   # must pass
npm run build       # must pass
```

## Architecture rules

- Three processes: `src/main` (Node), `src/preload` (bridge), `src/renderer` (React).
- The renderer NEVER touches Node APIs directly. Everything crosses IPC through
  `window.api`, defined in `src/preload/index.ts` and typed in `src/preload/index.d.ts`.
- Adding an IPC channel = three edits: `ipcMain.handle` in `src/main/index.ts`,
  bridge method in `src/preload/index.ts`, type in `src/preload/index.d.ts`.
- Shared data shapes live only in `src/shared/types.ts`.
- HTTP requests execute in the main process (`src/main/http.ts`) — do not move
  them to the renderer (CORS, forbidden headers).
- CDP capture lives in `src/main/cdp.ts` (chrome-remote-interface, port 9222).

## Conventions

- `window.prompt()` does not exist in Electron — use `textPrompt()` from
  `src/renderer/src/components/PromptHost.tsx`.
- Persistence is JSON files under `data/` (gitignored, may contain secrets);
  writes go through the queue in `src/main/storage.ts`.
- Keep response-body caps (10 MB) consistent between http.ts and cdp.ts.
- Styling is plain CSS in `src/renderer/src/styles.css` using CSS variables —
  no CSS framework; follow the existing class naming.
