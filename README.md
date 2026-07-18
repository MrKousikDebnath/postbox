# 📮 PostBox

```
  ____           _   ____
 |  _ \ ___  ___| |_| __ )  _____  __
 | |_) / _ \/ __| __|  _ \ / _ \ \/ /
 |  __/ (_) \__ \ |_| |_) | (_) >  <
 |_|   \___/|___/\__|____/ \___/_/\_\

  :: A Project by KD ::
```

[![A Project by KD](https://img.shields.io/badge/A%20Project%20by-KD-ff6c37)](https://github.com/MrKousikDebnath)
[![CI](https://github.com/MrKousikDebnath/postbox/actions/workflows/ci.yml/badge.svg)](https://github.com/MrKousikDebnath/postbox/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)

**API client + Chrome network recorder in one desktop app.**

Build and send API requests like Postman — and attach directly to Chrome via the
DevTools Protocol so that when you refresh a page, every upstream and downstream
service call is recorded with full headers, bodies, status and timing. Any recorded
call converts to an editable request with one click.

## Features

|     | API Client                                          | Network Recorder                                    |
| --- | --------------------------------------------------- | --------------------------------------------------- |
| ✅  | Method / URL / params / headers / body builder      | Attach to any Chrome tab (CDP, port 9222)           |
| ✅  | Multiple request tabs open at once                  | One-click "Launch Chrome (debug mode)"              |
| ✅  | Bearer, Basic, API-key auth helpers                 | Live capture from attach; `⟳ Reload` optional       |
| ✅  | Environments with `{{variable}}` substitution       | Headers, bodies, status, timing, size               |
| ✅  | Collapsible collections + folders, sort, search     | Filters: XHR / DOC / JS / OTHER / ALL + URL search  |
| ✅  | Pre-request + test scripts (`pm.*`)                 | Save / reopen recording sessions                    |
| ✅  | Collection editor: auth, scripts, variables, runner | "Open in API Client →" on any recorded call         |
| ✅  | cURL / Postman v2.1 import, export, code snippets   | 🤖 **Ask AI** — question the traffic, cited answers |
| ✅  | Collection history (JSON on disk), no CORS limits   | 7 switchable themes with a visual picker            |

## Quick start

Requires **Node 20** ([nvm](https://github.com/nvm-sh/nvm) recommended) and Google Chrome.

```bash
git clone https://github.com/MrKousikDebnath/postbox.git
cd postbox
nvm use
npm install
npm run dev
```

## Using the recorder

1. Switch to the **Network Recorder** tab.
2. Click **Launch Chrome (debug mode)** — starts a separate Chrome instance
   (own profile, doesn't touch your normal browser) with
   `--remote-debugging-port=9222`.
3. Open any site in that Chrome window, then in PostBox pick the tab from the
   auto-refreshing dropdown and attach.
4. Capture is **live from attach** — interact with the page (search, click,
   navigate) and every request streams into the table. Use **⟳ Reload** only to
   capture a fresh full page load (note: single-page apps reset to their start
   page on a hard reload).
5. Click a row for headers/body; **Open in API Client →** to replay/edit it, or
   **Save Session** to persist the recording (reopen via the 📼 Sessions dropdown).

## Ask AI (RAG over recorded traffic)

Click **🤖 Ask AI** in the recorder toolbar (live capture or a saved session) and ask
questions in natural language — _"where does `deviceUserAgentId` come from?"_, _"which
requests set cookies?"_, _"why did the search call fail?"_. PostBox retrieves the most
relevant recorded requests (ranking by URL/header/body matches, with a provenance boost
for requests whose **response** contains the value you asked about) and answers with inline
`[n]` citations linking back to the exact requests.

Three selectable backends (retrieval is local in all three; only answering differs):

- **Local (default)** — fully offline, rule-based provenance analysis. No key, no
  install, no network. Best for "where does X come from / which requests use it".
- **Ollama** — free local LLM at `localhost:11434` for natural-language answers
  (install from [ollama.com](https://ollama.com), `ollama pull llama3.1`).
- **Claude API** — paid, opt-in, highest quality. Uses `claude-opus-4-8`; key stored
  locally in `data/settings.json` (gitignored, never committed).

## Scripts & collection runner

Every request has a **Scripts** tab with Postman-style **Pre-request** and
**Post-response** editors (`pm.test`, `pm.expect`, `pm.response.*`,
`pm.environment.set/get`, `pm.variables.set`). Collections have their own editor
(the **⚙** icon) with **Overview / Authorization / Scripts / Variables / Run** —
collection scripts wrap every request, collection variables resolve as `{{name}}`,
and collection auth is inherited by requests whose own auth is "None". The
**collection runner** (▶) executes all requests in order with per-request status and
test results, chaining variables between them.

## Architecture

```
┌──────────────────────────────────────────────┐
│                 Electron app                 │
│  ┌──────────────┐  IPC   ┌────────────────┐  │
│  │   Renderer   │◄──────►│  Main process  │  │
│  │  React UI    │preload │  http.ts  fetch│──┼──► any API
│  │  client +    │        │  cdp.ts   CDP  │──┼──► Chrome :9222
│  │  recorder    │        │  storage  JSON │  │
│  └──────────────┘        └────────────────┘  │
└──────────────────────────────────────────────┘
```

```
src/
  main/            Electron main process (Node)
    index.ts       window + all IPC handlers
    http.ts        request executor (fetch, 60s timeout, 10MB cap)
    cdp.ts         Chrome DevTools Protocol bridge (recorder)
    ai.ts          RAG over traffic (local / ollama / anthropic)
    storage.ts     JSON persistence (data/*.json, atomic writes)
    banner.ts      startup ASCII banner
  preload/         contextBridge → window.api (+ index.d.ts types)
  renderer/src/
    App.tsx        app state: tabs, collections, envs, theme
    components/    Sidebar, RequestBuilder, ResponseViewer, Recorder,
                   AskAI, CollectionEditor, RunnerModal, ThemePicker,
                   EnvironmentManager, KeyValueEditor, PromptHost
    lib/           curl, postman, scripts, runtime (all unit-tested)
    util.ts        buildExecutable, {{var}} substitution, formatters
    themes.ts      theme metadata; styles.css has [data-theme] blocks
  shared/types.ts  data shapes shared across all three processes
scripts/           cdp-smoke-test.mjs (end-to-end recorder test)
data/              runtime state (gitignored): collections, environments,
                   history, sessions, settings (holds the AI key)
```

Request execution (Send and Run) is unified in `lib/runtime.ts` →
`runRequest()`: collection pre-request → request pre-request → send → request
test → collection test, with variables chaining through.

Full details for AI agents in [CLAUDE.md](CLAUDE.md) — the canonical project context.

## Development

Requires Node 20 — run `nvm use` first each session.

```bash
npm run dev            # app with hot reload
npm test               # unit tests (vitest)
npm run lint           # eslint
npm run format:check   # prettier --check .  (CI runs this on the whole repo)
npm run format         # prettier --write .
npm run typecheck      # tsc over main + renderer
npm run build          # production bundles
npm run dist           # package a distributable app (dmg/zip) into release/
node scripts/cdp-smoke-test.mjs   # end-to-end CDP capture test (headless Chrome)
```

Full gate before pushing (CI enforces all of these):
`npm run format:check && npm run lint && npm test && npm run typecheck && npm run build`

Releases: pushing a tag like `v0.2.0` triggers the Release workflow, which builds
the macOS app and attaches it to a GitHub Release automatically.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Limits (v1)

- Response bodies capped at 10 MB (client and recorder)
- Recorder captures from attach time — use _Reload & Record_ for a full page load
- WebSocket frames not captured yet
- Saved data (may include tokens) lives in `data/` — gitignored, keep it that way

## Roadmap

- [x] Test scripts (`pm.test` / `pm.expect`) + collection runner
- [x] Postman collection import/export, cURL import, code snippets
- [x] AI Q&A over recorded traffic
- [ ] Mock server (replay recorded sessions)
- [ ] OpenAPI 3.0 import/export
- [ ] WebSocket frame capture
- [ ] Embeddings-based retrieval for very large recordings

## License

[MIT](LICENSE)
