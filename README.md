# code-chapters

Learn unfamiliar code and code changes faster. Ask a question ("how does auth work?", "why are modules used here?", "what does this branch change?") and get back a **guide**: a few brief **chapters**, each showing one idea next to the exact code that proves it.

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
| [Spec](skill/code-chapters/SPEC.md) | The guide file format (`.code-chapters/*.json`) and its rules. |
| [Skill](skill/code-chapters/SKILL.md) | Instructions you give a coding agent so it writes good guides. The skill plus your question is all it needs. |
| Viewer | `code-chapters`, a local web app for reading guides chapter by chapter. |

Terms are defined in the [glossary](GLOSSARY.md). Code Chapters calls no AI services; your own agent writes the guides.

## Install

Requires Node 22.12+ and git.

```sh
npm install -g github:heron--/code-chapters   # or: git clone … && npm install && npm link
code-chapters install-skill                    # copies the skill to ~/.claude/skills/code-chapters
```

`install-skill` takes a directory if your agent keeps skills somewhere else. For agents without skill support, paste `SKILL.md` into the prompt and attach `SPEC.md`.

## Use

1. In any repo, ask your agent: `/code-chapters how does request retrying work?` or `/code-chapters explain this branch`.
2. The agent writes `.code-chapters/<slug>.json` and validates it with `code-chapters check`.
3. Run `code-chapters` anywhere inside the repo. It starts a local server and opens your browser.

```
code-chapters [dir | guide.json]   Open the viewer (default: the repo containing .)
code-chapters check <guide.json>…  Validate guides; exits 1 on errors
code-chapters install-skill [dir]  Install the authoring skill
  --port <n>   default 4646      --no-open   don't open a browser
```

### Reading a guide

- **Overview**: the question, the short answer, and the chapter list.
- **Guide**: one chapter at a time. Next/previous with the ↓ ↑ buttons, <kbd>⌘</kbd><kbd>⌥</kbd><kbd>⇧</kbd><kbd>↓</kbd>/<kbd>↑</kbd> (Ctrl+Alt+Shift elsewhere), or <kbd>J</kbd>/<kbd>K</kbd>.
- **Anchors** (dotted underlines) smoothly scroll the code to their lines and highlight them. **Go back** (or <kbd>Esc</kbd>) jumps back instantly.
- **Diff** (for changes): every changed file.
- "Reviewed" marks on chapters and files are saved in your browser.

This repo has a guide about itself: run `code-chapters` here and open *How anchors reach their lines*.

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
