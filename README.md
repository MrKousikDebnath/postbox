# 📮 PostBox

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

|     | API Client                                     | Network Recorder                            |
| --- | ---------------------------------------------- | ------------------------------------------- |
| ✅  | Method / URL / params / headers / body builder | Attach to any Chrome tab (CDP, port 9222)   |
| ✅  | Bearer, Basic, API-key auth helpers            | One-click "Launch Chrome (debug mode)"      |
| ✅  | Environments with `{{variable}}` substitution  | Reload & Record — captures every request    |
| ✅  | Collections + request history (JSON on disk)   | Headers, bodies, status, timing, size       |
| ✅  | No CORS limits (requests run in main process)  | Filters: XHR / DOC / JS / ALL + URL search  |
| ✅  | Pretty-printed JSON responses                  | "Open in API Client →" on any recorded call |

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
3. Open any site in that Chrome window, then in PostBox: **Refresh tabs** → pick the tab → attach.
4. Hit **⟳ Reload & Record**. Every request the page makes streams into the table live.
5. Click a row for headers/body; **Open in API Client →** to replay/edit it, or
   **Save Session** to persist the whole recording.

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

- `src/main/` — request executor, CDP bridge (`chrome-remote-interface`), JSON storage
- `src/preload/` — typed `window.api` context bridge
- `src/renderer/` — React UI
- `src/shared/` — types shared across all three

Details in [CLAUDE.md](CLAUDE.md) — which also gives AI coding agents full project context.

## Development

```bash
npm run dev         # app with hot reload
npm test            # unit tests (vitest)
npm run lint        # eslint
npm run typecheck   # tsc over main + renderer
npm run build       # production bundles
npm run dist        # package a distributable app (dmg/zip) into release/
node scripts/cdp-smoke-test.mjs   # end-to-end CDP capture test (headless Chrome)
```

Releases: pushing a tag like `v0.2.0` triggers the Release workflow, which builds
the macOS app and attaches it to a GitHub Release automatically.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Limits (v1)

- Response bodies capped at 10 MB (client and recorder)
- Recorder captures from attach time — use _Reload & Record_ for a full page load
- WebSocket frames not captured yet
- Saved data (may include tokens) lives in `data/` — gitignored, keep it that way

## Roadmap

- [ ] Pre-request / test scripts
- [ ] Mock server (replay recorded sessions)
- [ ] OpenAPI 3.0 + Postman collection import/export
- [ ] WebSocket frame capture
- [ ] cURL import/export

## License

[MIT](LICENSE)
