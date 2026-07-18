# Copilot instructions for PostBox

PostBox is a desktop **API client + Chrome network recorder** in one app.
Electron 31, React 18, TypeScript, electron-vite. **Node 20 required** (`.nvmrc`).

For the full architecture, component map, and execution flow, read `CLAUDE.md` at
the repo root — it is the canonical project context and stays in sync with the code.
This file is the short version.

## Build & verify (must pass — CI enforces all of these on the whole repo)

```bash
npm ci
npm run format:check   # prettier --check .   ← runs on the WHOLE repo, not just src/
npm run lint
npm test
npm run typecheck
npm run build
```

Run `npm run format` before committing so no stray file fails the format check.

## Architecture rules

- Three processes: `src/main` (Node), `src/preload` (bridge), `src/renderer` (React).
- The renderer **never** touches Node APIs directly — everything crosses IPC via
  `window.api`, defined in `src/preload/index.ts` and typed in
  `src/preload/index.d.ts`.
- **Adding an IPC channel = three edits:** `ipcMain.handle` in `src/main/index.ts`,
  bridge method in `src/preload/index.ts`, type in `src/preload/index.d.ts`.
- Shared data shapes live only in `src/shared/types.ts`.
- HTTP requests execute in the main process (`src/main/http.ts`) — never move them
  to the renderer (CORS, forbidden headers). CDP capture is `src/main/cdp.ts`
  (port 9222). AI/RAG is `src/main/ai.ts`.
- Request execution (Send and Run) goes through `runRequest()` in
  `src/renderer/src/lib/runtime.ts`: collection pre-request → request pre-request →
  send → request test → collection test.

## Feature map (where things live)

- Request builder + Scripts (pre/post) + code snippets: `components/RequestBuilder.tsx`
- Collections/folders/import/export/run: `components/Sidebar.tsx`
- Collection editor (auth/scripts/variables): `components/CollectionEditor.tsx`
- Collection runner: `components/RunnerModal.tsx`
- Recorder + saved sessions: `components/Recorder.tsx`
- Ask AI (local / Ollama / Claude backends): `components/AskAI.tsx`, `main/ai.ts`
- Themes: `themes.ts` + `[data-theme]` blocks in `styles.css`; picker in `ThemePicker.tsx`
- Parsers/converters (unit-tested): `lib/curl.ts`, `lib/postman.ts`, `lib/scripts.ts`

## Conventions

- `window.prompt()` does not exist in Electron — use `textPrompt()` from
  `components/PromptHost.tsx`.
- Persistence is JSON files under `data/` (gitignored; `settings.json` holds a
  secret). Writes go through the queue in `src/main/storage.ts`.
- Keep response-body caps (10 MB) consistent between `http.ts` and `cdp.ts`.
- Styling is plain CSS in `src/renderer/src/styles.css` using CSS variables keyed
  by `[data-theme]` — no CSS framework; follow the existing class naming.
- New AI backends: add to the `Backend` union and `ask()` switch in `main/ai.ts`,
  and a chip in `components/AskAI.tsx`.
