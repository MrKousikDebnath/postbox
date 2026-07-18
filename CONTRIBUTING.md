# Contributing to PostBox

## Setup

```bash
nvm use          # Node 20, pinned in .nvmrc
npm install
npm run dev      # launches the app with hot reload
```

## Before opening a PR

```bash
npm run typecheck
npm run build
node scripts/cdp-smoke-test.mjs   # if you touched the recorder (needs Chrome installed)
```

All three must pass. CI runs typecheck + build on every PR.

## Project layout

See [CLAUDE.md](CLAUDE.md) for the architecture walkthrough — it doubles as
contributor documentation. Key rule: the renderer never calls Node APIs;
everything crosses IPC via `src/preload/`.

## Commit style

Short imperative subject line ("Add WebSocket capture"), body explaining why
when it isn't obvious.
