# AGENTS.md

Context for AI coding agents (OpenAI Codex / GPT, Cursor, and any tool that reads
`AGENTS.md`). **[CLAUDE.md](CLAUDE.md) is the canonical, full project context** —
architecture, component map, execution flow, and gotchas. Read it before non-trivial
work. This file is the quick orientation.

## Project

PostBox — a desktop **API client + Chrome network recorder** in one app.
Electron 31, React 18, TypeScript, electron-vite. **Node 20 required** (`.nvmrc`).

## Setup & the full gate (CI enforces all of these on the whole repo)

```bash
nvm use          # Node 20 — do this first
npm install
npm run dev      # launch with hot reload

# before committing / opening a PR:
npm run format:check   # prettier --check .  (a stray unformatted file fails CI)
npm run lint
npm test
npm run typecheck
npm run build
```

`npm run format` fixes formatting.

## Architecture (three processes)

- `src/main/` — Node main process: `index.ts` (window + all IPC handlers),
  `http.ts` (request executor via fetch), `cdp.ts` (Chrome DevTools recorder,
  port 9222), `ai.ts` (RAG over recorded traffic: local / ollama / anthropic),
  `storage.ts` (JSON in `data/`, gitignored), `banner.ts`.
- `src/preload/` — `contextBridge` → `window.api`; typed in `index.d.ts`.
- `src/renderer/src/` — React UI. `App.tsx` owns state; `components/` has the UI;
  `lib/` has unit-tested logic (`curl`, `postman`, `scripts`, `runtime`).
- `src/shared/types.ts` — data shapes shared across all three processes.

## Rules

- The renderer never calls Node APIs directly — everything crosses IPC via
  `window.api`. **Adding an IPC channel = three edits:** `ipcMain.handle` in
  `src/main/index.ts`, bridge method in `src/preload/index.ts`, type in
  `src/preload/index.d.ts`.
- HTTP requests run in the main process (CORS/headers). CDP capture is `main/cdp.ts`.
- Request execution (Send and Run) goes through `runRequest()` in
  `src/renderer/src/lib/runtime.ts`: collection pre-request → request pre-request →
  send → request test → collection test.
- `window.prompt()` doesn't exist in Electron — use `textPrompt()` from
  `components/PromptHost.tsx`.
- Themes are CSS variables keyed by `[data-theme]` in `styles.css` + `themes.ts`.
- Never commit `data/` (holds state and the AI API key).

See [CLAUDE.md](CLAUDE.md) for everything else.
