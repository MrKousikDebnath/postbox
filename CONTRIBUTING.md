# Contributing to PostBox

## Setup

```bash
nvm use          # Node 20, pinned in .nvmrc
npm install
npm run dev      # launches the app with hot reload
```

## Before opening a PR — run the full gate

CI enforces every one of these on the **whole repo**, so run them all locally first:

```bash
npm run format:check   # prettier --check .   (a stray unformatted file fails CI)
npm run lint
npm test
npm run typecheck
npm run build
node scripts/cdp-smoke-test.mjs   # if you touched the recorder (needs Chrome)
```

`npm run format` fixes formatting. All must pass — the CI pipeline runs the same steps.

## Project layout & context

[CLAUDE.md](CLAUDE.md) is the canonical project context — architecture, the
three-process model, component map, execution flow, and the gotchas. Read it before
making changes; it doubles as contributor documentation and is kept in sync with the
code. The short version also lives in [.github/copilot-instructions.md](.github/copilot-instructions.md).

Key rule: the renderer never calls Node APIs directly — everything crosses IPC via
`src/preload/`. Adding an IPC channel means three edits (main handler, preload bridge,
`.d.ts` type).

## Commit style

Short imperative subject line ("Add WebSocket capture"), body explaining why when it
isn't obvious.
