# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project

PostBox — a desktop API client (Postman-style) combined with a Chrome network
recorder, built with Electron 31 + React 18 + TypeScript + electron-vite.

## Commands

Requires Node 20 (`.nvmrc`). All commands from the repo root:

```bash
npm install                       # install deps
npm run dev                       # launch the app in dev mode (hot reload)
npm run build                     # production bundles into out/
npm run typecheck                 # tsc over both main and renderer projects
node scripts/cdp-smoke-test.mjs   # end-to-end CDP capture test (headless Chrome, port 9223)
```

There is no test framework yet; `scripts/cdp-smoke-test.mjs` is the only automated check
besides typecheck/build.

## Architecture

Electron three-process model; the split matters for every change:

- `src/main/` — Node.js main process.
  - `index.ts` — window creation and ALL `ipcMain.handle` registrations.
  - `http.ts` — executes API requests via fetch (60s timeout, 10 MB body cap).
    Runs here so requests bypass CORS and can set any header.
  - `cdp.ts` — Chrome DevTools Protocol bridge (`chrome-remote-interface`),
    attaches to Chrome on port 9222, streams Network.* events to the renderer
    via `webContents.send('cdp:request-update', …)`.
  - `storage.ts` — JSON persistence in `data/` (gitignored), atomic writes via
    tmp-file + rename, serialized through a write queue.
- `src/preload/` — `contextBridge` exposes `window.api`; every renderer↔main
  call goes through here. `index.d.ts` types the whole surface — update it
  whenever an IPC channel is added.
- `src/renderer/src/` — React UI. `App.tsx` owns all app state (collections,
  history, environments, active request). Two views: API client and Recorder.
- `src/shared/types.ts` — types used by all three layers; the single source of
  truth for data shapes.

## Constraints and gotchas

- `window.prompt()` is NOT implemented in Electron renderers — use
  `textPrompt()` from `src/renderer/src/components/PromptHost.tsx`.
- Storage lives in `data/*.json` and may contain tokens — never commit it.
- New IPC channels require three edits: handler in `src/main/index.ts`,
  bridge method in `src/preload/index.ts`, type in `src/preload/index.d.ts`.
- Response bodies are capped at 10 MB in both http.ts and cdp.ts — keep the
  caps aligned.
- The recorder launches a separate Chrome instance with profile
  `~/.postbox-chrome-profile` to avoid clashing with the user's main Chrome.
