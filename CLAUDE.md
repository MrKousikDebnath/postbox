# CLAUDE.md

Guidance for Claude Code (and any AI agent) working in this repository. This file
is the single source of truth for project context — read it fully before starting
work, then you can pick up any task without re-discovering the codebase.

> **Sibling AI-context files point here.** `AGENTS.md` (OpenAI Codex / GPT / Cursor),
> `GEMINI.md` (Gemini), and `.github/copilot-instructions.md` (Copilot) are concise
> orientations that defer to this file. When the architecture changes materially,
> update this file first; the others are short and rarely need edits.

## What PostBox is

A desktop app that combines **two tools in one**:

1. **API client** — a Postman-style request builder: collections, folders,
   environments, auth, pre-request + test scripts, a collection runner, cURL /
   Postman import, code-snippet export.
2. **Network recorder** — attaches to Chrome via the DevTools Protocol and records
   every request a page makes (live), with a local/offline **Ask AI** panel that
   answers questions about the captured traffic ("where does this value come from?").

Stack: **Electron 31 + electron-vite + React 18 + TypeScript**. Node 20 required.

## Commands

All from the repo root. Node 20 is mandatory (`.nvmrc`); the system default may be
older, so use nvm:

```bash
source ~/.nvm/nvm.sh && nvm use     # select Node 20 (do this first each session)
npm install                          # install deps (first time)
npm run dev                          # launch the app with hot reload
npm run build                        # production bundles into out/
npm run dist                         # package a distributable (dmg/zip) into release/
npm test                             # vitest unit tests
npm run lint                         # eslint (flat config)
npm run format:check                 # prettier --check .  (CI runs this on the WHOLE repo)
npm run format                       # prettier --write .
npm run typecheck                    # tsc over main + renderer projects
node scripts/cdp-smoke-test.mjs      # end-to-end CDP capture test (headless Chrome, port 9223)
```

**Before pushing, run the full gate** — CI fails on any of these:
`npm run format:check && npm run lint && npm test && npm run typecheck && npm run build`.
(A stray unformatted file anywhere in the repo, not just `src/`, will fail
`format:check` — this has bitten us before.)

## Architecture (Electron three-process model)

The process split is load-bearing for almost every change:

```
┌──────────────────────────────────────────────────────────┐
│                       Electron app                         │
│  ┌────────────────┐   IPC    ┌──────────────────────────┐ │
│  │    Renderer     │◄────────►│       Main process        │ │
│  │  (React UI)     │ preload  │  http.ts   → fetch        │─┼─► any API
│  │                 │  bridge  │  cdp.ts    → CDP          │─┼─► Chrome :9222
│  │                 │          │  ai.ts     → RAG/LLM      │ │
│  │                 │          │  storage.ts→ data/*.json  │ │
│  └────────────────┘          └──────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- **`src/main/`** — Node.js main process (full OS access):
  - `index.ts` — window creation + **every** `ipcMain.handle` registration. The
    catalogue of what the renderer can ask the backend to do lives here.
  - `http.ts` — executes API requests via `fetch` (60s timeout, 10 MB body cap).
    Runs here so requests bypass CORS and can set any header.
  - `cdp.ts` — Chrome DevTools Protocol bridge (`chrome-remote-interface`). Attaches
    to Chrome on port 9222, streams `Network.*` events to the renderer via
    `webContents.send('cdp:request-update', …)`, holds captured records + bodies,
    can launch a debug Chrome instance and reload the page.
  - `ai.ts` — **RAG over recorded traffic**, three backends: `local` (offline
    rule-based provenance analyzer, default), `ollama` (local LLM at
    `localhost:11434`), `anthropic` (paid Claude API, opt-in). Shared local
    retrieval ranks requests by keyword + provenance (a value in a request's
    _response_ scores as its origin). Uses `@anthropic-ai/sdk` for the anthropic path.
  - `storage.ts` — JSON persistence in `data/` (gitignored). Atomic writes
    (tmp-file + rename), serialized through a write queue.
  - `banner.ts` — Spring-Boot-style ASCII banner printed on app start.
- **`src/preload/`** — `contextBridge` exposes `window.api`. Every renderer↔main
  call goes through here. `index.d.ts` types the entire surface.
- **`src/renderer/src/`** — React UI (see component map below).
- **`src/shared/types.ts`** — types used by all three layers; the single source of
  truth for data shapes (`ApiRequest`, `Collection`, `Environment`,
  `RecordedRequest`, `RecordingSession`, etc.).

### Adding an IPC channel = three coordinated edits

1. `ipcMain.handle('channel', ...)` in `src/main/index.ts`
2. bridge method in `src/preload/index.ts`
3. type in `src/preload/index.d.ts`

Miss any one and it fails silently or won't type-check.

## Renderer component map

- `App.tsx` — owns app state: collections, history, environments, active env,
  open request **tabs** (multiple), per-tab responses + test outcomes, theme,
  which collection is being edited/run. Also finds a request's owning collection
  (by id) so single-send applies collection scripts.
- `components/Sidebar.tsx` — collections + history. Collapsible collections/folders,
  sort (name/method), search, request duplicate/rename/delete, folder CRUD,
  Postman import (⇪), cURL import (⌘), export (⇩), run (▶), edit collection (⚙).
- `components/RequestBuilder.tsx` — method/URL/params/headers/body/auth, plus a
  **Scripts** tab (Pre-request | Post-response sub-tabs) and a **Code** snippet modal.
- `components/ResponseViewer.tsx` — status/time/size + Body / Headers / Tests tabs.
- `components/CollectionEditor.tsx` — the ⚙ modal: Overview / Authorization /
  Scripts (pre+post) / Variables / Run.
- `components/RunnerModal.tsx` — collection runner; runs requests sequentially with
  status + test results, variables chaining across requests.
- `components/EnvironmentManager.tsx` — environments + `{{variable}}` sets.
- `components/Recorder.tsx` — the network recorder view: attach to a Chrome tab,
  live capture, filters, saved sessions, request detail, "Open in API Client →",
  and the Ask AI toggle.
- `components/AskAI.tsx` — the RAG chat panel with the backend selector.
- `components/ThemePicker.tsx` — theme dropdown with visual swatches.
- `components/PromptHost.tsx` — `textPrompt()` replacement for `window.prompt`
  (see gotchas).
- `components/KeyValueEditor.tsx` — reusable enabled/key/value rows.

### Renderer libs (`src/renderer/src/lib/`, all unit-tested)

- `curl.ts` — `parseCurl`, `toCurl`, `toFetch`, `toAxios`.
- `postman.ts` — `importPostmanCollection`, `exportPostmanCollection` (v2.1).
- `scripts.ts` — the `pm` sandbox: `runTestScript` (post-response) and
  `runPreRequestScript` (pre-request). Chai-style `pm.expect`, `pm.test`,
  `pm.response.*`, `pm.environment`/`pm.variables`.
- `runtime.ts` — **`runRequest()`**: the unified execution chain used by both
  single-send and the runner — collection pre-request → request pre-request →
  send → request test → collection test. Variables chain through; collection auth
  is inherited when the request's own auth is `none`.
- `../util.ts` — `buildExecutable` (resolve a request + env into a concrete
  fetch), `{{var}}` substitution, `recordedToApiRequest`, formatters.
- `../themes.ts` — theme metadata + apply/load (persisted in localStorage).

## Execution flow (Send / Run)

`runRequest(request, collection, env)` in `lib/runtime.ts`:

1. Merge variables: collection variables (base) < active environment.
2. Run collection pre-request script, then request pre-request script — each may
   `pm.environment.set(...)`, feeding `{{var}}` substitution.
3. Compute effective auth (inherit collection auth if request auth is `none`).
4. `buildExecutable` → `window.api.sendRequest` (runs in main process via fetch).
5. Run request test script, then collection test script.
6. Return `{ response, tests, envUpdates, consoleLines, scriptError }`.

Env updates persist back into the active environment. On single-send, collection
scripts apply only if the request is saved into a collection (found by id); a
brand-new unsaved tab runs only its own request-level scripts. The runner always
applies collection-level scripts + variables since it iterates a known collection.

## Recorder flow

1. Attach to a Chrome tab (port 9222). If Chrome has no debug port, the recorder
   can launch a separate debug instance (profile `~/.postbox-chrome-profile`).
2. Capture is **live from attach** — interact with the page and requests stream in.
   `⟳ Reload` is secondary (SPAs like IRCTC reset to their start page on a hard
   reload, so it's not the primary action).
3. Save Session persists to `data/sessions.json`; reopen via the 📼 Sessions dropdown.
4. Ask AI (🤖) answers questions about the live capture or a saved session.

## Data / persistence (all in `data/`, gitignored)

- `collections.json`, `environments.json`, `history.json`, `sessions.json`
- `settings.json` — AI backend choice + Anthropic API key + Ollama model.
  **May contain a secret — never commit it.** `data/` is in `.gitignore`.

## Constraints and gotchas (read before editing)

- **`window.prompt()` is not implemented in Electron renderers.** Use
  `textPrompt()` from `src/renderer/src/components/PromptHost.tsx`.
- **New IPC channels need three edits** (main handler, preload bridge, `.d.ts` type).
- **Response bodies capped at 10 MB** in both `http.ts` and `cdp.ts` — keep aligned.
- **Themes** are CSS variables keyed by `[data-theme]` on the root; method colors
  are variables with `color-mix`-derived tints. Add a theme by adding a block in
  `styles.css` and an entry in `themes.ts`.
- **z-index / stacking:** glass panels use `backdrop-filter`, which creates
  stacking contexts. The topbar is lifted to `z-index: 100` so dropdowns render
  above the body — keep new popovers within that context or they'll hide behind panels.
- **Format check runs on the whole repo.** Don't leave stray/scratch files
  unformatted; run `npm run format` before committing.
- **Node 20 only** — the system default may be older; always `nvm use` first.
- The recorder launches a **separate** debug Chrome (own profile) so it never
  clashes with the user's normal browser; analytics beacons (GA) often FAIL there
  because that profile has no consent cookies — expected, not a bug.

## CI / infra

- `.github/workflows/ci.yml` — lint + format check + tests + typecheck + build on
  every push/PR.
- `.github/workflows/codeql.yml` — security scanning.
- `.github/workflows/release.yml` — tag `v*` builds a macOS dmg/zip and attaches it
  to a GitHub Release.
- Dependabot config in `.github/dependabot.yml`.

## Roadmap (not yet built)

Mock server (replay recorded sessions), OpenAPI import/export, WebSocket frame
capture, embeddings-based retrieval for very large recordings.
