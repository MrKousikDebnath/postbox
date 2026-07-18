# GEMINI.md

Context for Gemini CLI / Google AI coding tools. **[CLAUDE.md](CLAUDE.md) is the
canonical, full project context** (architecture, component map, execution flow,
gotchas) and [AGENTS.md](AGENTS.md) is the same quick orientation. This file exists
so Gemini-based tools find their expected filename — the content below is a summary;
defer to CLAUDE.md for depth.

## Project

PostBox — a desktop **API client + Chrome network recorder** in one app.
Electron 31, React 18, TypeScript, electron-vite. **Node 20 required** (`.nvmrc`).

## Setup & the full gate (CI enforces all on the whole repo)

```bash
nvm use          # Node 20 — do this first
npm install
npm run dev      # launch with hot reload

# before committing:
npm run format:check   # prettier --check .  (a stray unformatted file fails CI)
npm run lint
npm test
npm run typecheck
npm run build
```

## Architecture (three processes)

- `src/main/` — Node main process: `index.ts` (window + all IPC handlers),
  `http.ts` (fetch executor), `cdp.ts` (Chrome DevTools recorder, port 9222),
  `ai.ts` (RAG over recorded traffic: local / ollama / anthropic), `storage.ts`
  (JSON in `data/`, gitignored).
- `src/preload/` — `contextBridge` → `window.api`; typed in `index.d.ts`.
- `src/renderer/src/` — React UI (`App.tsx` state, `components/`, unit-tested `lib/`).
- `src/shared/types.ts` — shared data shapes.

## Rules

- Renderer never calls Node directly — everything crosses IPC via `window.api`.
  Adding an IPC channel = three edits (main handler, preload bridge, `.d.ts` type).
- Request execution goes through `runRequest()` in `src/renderer/src/lib/runtime.ts`.
- `window.prompt()` doesn't exist in Electron — use `textPrompt()` from
  `components/PromptHost.tsx`.
- Never commit `data/` (state + AI API key).

See [CLAUDE.md](CLAUDE.md) for the full detail.
