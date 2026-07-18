# PostBox

API client (Postman-style) + Chrome network recorder in one Electron app.

## Requirements

- Node 20 (`nvm use` — pinned in `.nvmrc`). Do **not** run with the system default Node 10.

## Run

```bash
nvm use
npm install        # first time only
npm run dev        # launches the app
```

Other commands:

```bash
npm run build      # production bundles into out/
npm run typecheck  # tsc over main + renderer
node scripts/cdp-smoke-test.mjs   # verifies CDP capture against headless Chrome
```

## Features

### API Client
- Method / URL / query params / headers / body (JSON, raw, form-urlencoded)
- Auth helpers: Bearer, Basic, API key header
- Environments with `{{variable}}` substitution (topbar selector → Manage)
- Collections (save/rename/delete) and request history — persisted as JSON under `data/`
- Requests execute in the Electron main process: no CORS restrictions, full header control

### Network Recorder
1. Switch to the **Network Recorder** tab.
2. If Chrome isn't running with a debug port, click **Launch Chrome (debug mode)** —
   this starts a separate Chrome instance (own profile at `~/.postbox-chrome-profile`)
   with `--remote-debugging-port=9222`. Alternatively start your own:
   `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=$HOME/.postbox-chrome-profile`
3. Pick a tab and attach.
4. **⟳ Reload & Record** reloads the page and captures every request: upstream calls,
   XHR/fetch, documents, scripts — with headers, bodies, status, timing, size.
5. Click any row for details; **Open in API Client →** turns a recorded call into an
   editable request. **Save Session** persists the full recording to `data/sessions.json`.

Filters: XHR (fetch/XHR), DOC, JS, OTHER, ALL + URL text search.

## Architecture

```
src/main/      Electron main process
  index.ts     window + IPC registration
  http.ts      request executor (fetch, 60s timeout, 10MB body cap)
  cdp.ts       Chrome DevTools Protocol bridge (chrome-remote-interface)
  storage.ts   JSON persistence (data/*.json, atomic writes)
src/preload/   contextBridge API (window.api)
src/renderer/  React UI (client + recorder views)
src/shared/    types shared across processes
```

## Notes / limits (v1)

- Response bodies capped at 10 MB in both client and recorder.
- Recorder must be attached *before* the traffic happens; use Reload & Record.
- WebSocket frames are not captured yet (connections show as requests only).
- `data/` contains your saved requests/tokens — do not commit it if this becomes a repo.
