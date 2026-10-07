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

Run `code-guide` anywhere inside a git repository. It starts a session and a local server and opens your browser, where you pick a subject: a change, a path, or a question. Code Guide writes a guide about it (and has another job review it), and you can ask questions as you read.

```
code-guide [dir]                   Start a session (default: the repo containing .)
code-guide check <guide.json>…     Validate guides; exits 1 on errors
  --change <base>[...<head>]   --path <path>   --question <text>   pick the subject up front
  --harness <name>   --model <m>   --review-model <m>
  --port <n>   default 4646      --no-open   don't open a browser
```

Sessions are kept in `.code-guide/sessions/` in the repository; add it to your `.gitignore` if you like.

### Reading a guide

The browser shows a workspace: two slots side by side and a dock along the bottom. Jobs that are still running wait in the dock with their progress; click a square to open it, or drag it up into a slot.

- **Guide**: one chapter at a time, its prose and file list beside the code. Keys work while focus is in the panel: <kbd>J</kbd>/<kbd>K</kbd> (or <kbd>⌥</kbd><kbd>↓</kbd>/<kbd>↑</kbd>) for chapters, <kbd>[</kbd>/<kbd>]</kbd> for files, <kbd>R</kbd> to mark the chapter Reviewed.
- **Diff** (for changes): every changed file. Open it from **New panel**.
- **Anchors** (accent-coloured links in the prose) scroll the code to their lines and highlight them. **Go back** (or <kbd>Esc</kbd>) jumps back instantly.
- "Reviewed" marks and the layout are saved in your browser.

This repo has a guide about itself in `.code-chapters/how-anchors-work.json`; `code-guide check` validates it.

## Develop

```sh
npm install          # also builds dist/
npm run check        # typecheck, format check, tests
npm run build        # dist/ui (Vite) + dist/cli.js (tsup)

# Live UI development: run the API, then Vite with a proxy to it
node dist/cli.js --no-open --port 4646 &
npm run dev
```

Layout: `src/shared` (guide schema and prose parsing), `src/server` (CLI, git resolution, validation, highlighting), `src/modules` (each module: its job and its panel), `src/ui` (React + Tailwind: the workspace).
