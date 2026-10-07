# Code Guide

Learn unfamiliar code and code changes faster. Ask a question ("how does auth work?", "why is this split into packages?", "what does this branch change?") and get back a **guide**: a few brief **chapters**, each showing one idea next to the exact code that proves it.

```
┌ Retry only safe requests ─────────┐ ┌ client.ts  src ──────────────── +23 -10 ┐
│ 02 / 03   ↓ ↑   ☐ Reviewed        │ │ 10  const IDEMPOTENT = new Set([...]);  │
│                                   │ │ 11  const RETRYABLE = new Set([...]);   │
│ Only idempotent methods get more  │ │ ⇕ 7 unchanged lines                     │
│ than one attempt; a repeated POST │ │ 31  if (!RETRYABLE.has(res.status) ...  │
│ could double-write.               │ │ 32    log("request failed", ...);       │
│       ┈┈┈┈┈┈┈┈┈┈┈┈ ← anchor       │ │ 33    throw new Error(...);             │
└───────────────────────────────────┘ └─────────────────────────────────────────┘
```

There are three parts:

| Part | What it is |
| --- | --- |
| [Spec](docs/spec.md) | The guide format and its rules. `code-guide check` enforces them. |
| Guide job | Code Guide drives your coding agent (Claude Code by default, through the Claude Agent SDK) to write a guide, read-only, with [these instructions](src/modules/guide/instructions.ts). A guide is accepted only once it passes the spec. |
| Viewer | `code-guide`, a local web app for reading guides chapter by chapter. |

Terms are defined in the [glossary](GLOSSARY.md). Code Guide sends nothing anywhere itself; the agent it drives talks to its own model.

## Install

Requires Node 22.12+, git, and Claude Code signed in (`claude`).

```sh
npm install -g github:heron--/code-chapters   # or: git clone … && npm install && npm link
```

## Use

Run `code-guide` anywhere inside a repo. It starts a local server and opens your browser.

```
code-guide [dir | guide.json]      Open the viewer (default: the repo containing .)
code-guide check <guide.json>…     Validate guides; exits 1 on errors
  --port <n>   default 4646      --no-open   don't open a browser
```

Starting a session on a subject (a change, a path or a question) and watching its guide get written arrives with the workspace (M8). Until then the viewer opens guides in `.code-chapters/*.json`.

### Reading a guide

- **Overview**: the question, the short answer, and the chapter list.
- **Guide**: one chapter at a time. Next/previous with the ↓ ↑ buttons, <kbd>⌘</kbd><kbd>⌥</kbd><kbd>⇧</kbd><kbd>↓</kbd>/<kbd>↑</kbd> (Ctrl+Alt+Shift elsewhere), or <kbd>J</kbd>/<kbd>K</kbd>.
- **Anchors** (dotted underlines) smoothly scroll the code to their lines and highlight them. **Go back** (or <kbd>Esc</kbd>) jumps back instantly.
- **Diff** (for changes): every changed file.
- "Reviewed" marks on chapters and files are saved in your browser.

This repo has a guide about itself: run `code-guide` here and open *How anchors reach their lines*.

## Develop

```sh
npm install          # also builds dist/
npm run check        # typecheck, format check, tests
npm run build        # dist/ui (Vite) + dist/cli.js (tsup)

# Live UI development: run the API, then Vite with a proxy to it
node dist/cli.js --no-open --port 4646 &
npm run dev
```

Layout: `src/shared` (guide schema and prose parsing), `src/server` (CLI, git resolution, validation, highlighting), `src/ui` (React + Tailwind + Radix/shadcn-style components).
