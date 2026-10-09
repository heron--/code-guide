# Code Guide

Learn unfamiliar code and code changes faster. Pick a subject (a change, a path, or a question like "how does auth work?") and Code Guide has your coding agent write a **guide**: a few brief **chapters**, each showing one idea next to the exact code that proves it.

```
┌ Retry only safe requests ──────────┐ ┌ client.ts  src ──────────────── +23 -10 ┐
│ 02 / 03  ↑ ↓  ☐ Reviewed      Ask  │ │ 10  const IDEMPOTENT = new Set([...]);  │
│                                    │ │ 11  const RETRYABLE = new Set([...]);   │
│ Only idempotent methods get more   │ │ ⇕ 7 unchanged lines                     │
│ than one attempt; a repeated POST  │ │ 31  if (!RETRYABLE.has(res.status) ...  │
│ could double-write.                │ │ 32    log("request failed", ...);       │
│       ┈┈┈┈┈┈┈┈┈┈┈┈ ← anchor        │ │ 33    throw new Error(...);             │
└────────────────────────────────────┘ └─────────────────────────────────────────┘
```

There are three parts:

- **[Spec](docs/spec.md)**: the guide format and its rules. `code-guide check` enforces them, and so does every guide job.
- **Jobs**: background work by your coding agent, read-only, through a harness: Claude Code (the default, via the Claude Agent SDK) or [pi](https://github.com/badlogic/pi-mono). The guide job follows [these instructions](src/modules/guide/instructions.ts); a separate review job then judges the guide against a quality bar.
- **Viewer**: a local web app for reading the guide chapter by chapter, with an overview, the diff, a quiz, a trace and a chat beside it.

Terms are defined in the [glossary](GLOSSARY.md).

## Install

Requires Node 22.12+, git, and Claude Code signed in (run `claude` once). To use pi instead, sign in to a model in `pi` and run `code-guide --harness pi`, with `--model provider/id` to choose one (otherwise pi's default model).

The [GitHub CLI](https://cli.github.com/) (`gh`), signed in, is optional. With it, open pull requests are offered as subjects and the Overview shows a pull request's description.

```sh
npm install -g github:heron--/code-guide   # or: git clone … && npm install && npm link
```

## Use

Run `code-guide` anywhere inside a git repository. It starts a session, serves the viewer on `127.0.0.1`, and opens your browser.

```
code-guide [dir]                   Start a session in the repo containing dir (default: .)
code-guide check <guide.json>…     Validate guides against the spec; exits 1 on errors
code-guide --version               The version and the commit it was built from, e.g. 0.1.0#a1b2c

  --change <base>[...<head>]   --branch <name>   --pr <number|link>
  --path <path>   --question <text>                                choose the subject up front
  --harness <claude|pi|fake>   --model <m>   --review-model <m>    reviews default to --model
  --port <n>                   default 4646, or the next free port after it
  --open / --no-open           open a browser, or don't (default: open)
```

### Choosing a subject

The browser asks what you want to understand and suggests the subjects that apply: uncommitted changes, the current branch against the default branch when it's ahead, and the 10 newest open pull requests (with `gh`). For any other branch, type its name (local or on origin) to see what it changes compared to the default branch; for any other pull request, paste its link or type its number (`#12`). You can also type a commit range (`main...feature`), a path in the repository, or anything else as a question. `--change`, `--branch`, `--pr`, `--path` and `--question` skip the picker. A session has one subject; run `code-guide` again for another. The status bar names it; a question is named by its guide's title once the guide is written, with the full question on hover.

A change runs from the merge-base of its base and head to its head, or to the working tree when it has no head. Code Guide fetches the base from its remote first, so a stale local copy doesn't pull other people's commits into the change; offline, it uses the local copy. For a pull request it fetches the head commit without creating a branch.

When a change comes from a pull request, the status bar links to it (with `gh`). While the subject is the pull request itself, Code Guide checks it every minute; when new commits are pushed, the status bar offers **Update modules**, which moves the session to the latest commit and writes its guide and overview again. A quiz waits for you to start it again, so it isn't built from the old guide.

### Jobs

Choosing a subject starts two jobs: the guide and the overview. Every guide goes to a review job that sees only the guide and the code. If the review asks for changes, one revision is written and reviewed again, and you see the latest guide that passed the spec. The quiz job starts when you open Quiz, once the guide is done. Opening Trace starts a quick job that proposes scenarios; picking one starts the job that writes its trace, step by step, each batch checked against the code as it's written.

A job submits its result through a tool that checks it; errors go back to the agent, which gets 5 submissions to fix them. Two jobs run at a time. The agent can read and search files inside the repository and run single read-only git commands; it can't edit anything. A failed job shows its reason in its panel and dock square, with **Retry**.

While the session runs, the **console** (what Code Guide prints in the terminal) shows the chat's agent (harness, model, how full its context is, and whether it's thinking, writing, in a tool call or idle) and a progress bar for each running job, with the subject and finished and failed jobs logged above. It starts with the version and the commit it was built from (`-dirty` if the build had uncommitted changes), so you can tell whether your install is up to date.

### Reading a guide

The browser shows a workspace: two slots side by side and a dock along the bottom. A new session opens Guide on the left, showing its progress while it's written, and Chat on the right. Other panels wait in the dock as squares, marked when they have a new result: click one to open it, or drag it up into a slot. Drag a panel's title bar onto the other slot to swap them, or the divider to resize. **New panel** opens any module, or says why it can't yet.

- **Overview**: a short summary of the subject, an intro before the chapters. For a change with a pull request, a second tab shows the pull request's description. The summary, the description and chat replies render as Markdown; raw HTML in them shows as text.
- **Guide**: one chapter at a time, its prose and file list beside the code. The code scrolls straight through every chapter and the prose follows: a chapter becomes current as its first file reaches the top (or, scrolling up, as its last file comes back). The prose column widens with the panel, up to a comfortable line length. Keys work while focus is in the panel (hover the chapter arrows for a reminder): <kbd>J</kbd>/<kbd>K</kbd> (or <kbd>⌥</kbd><kbd>↓</kbd>/<kbd>↑</kbd>) for chapters, <kbd>[</kbd>/<kbd>]</kbd> for files, <kbd>R</kbd> to mark the chapter Reviewed. Each file can be marked Reviewed too, which collapses it. The status bar counts the chapters you've reviewed.
- **Anchors** (accent-coloured links in the prose) scroll the code to their lines and highlight them. **Go back** (or <kbd>⌘</kbd><kbd>[</kbd> / <kbd>Ctrl</kbd><kbd>[</kbd>, or <kbd>Esc</kbd>) jumps back.
- **Glossary terms**: guides use the repository's own terms from its `glossary.md` (at the root, any case; a Term | Definition table, like [this one](GLOSSARY.md)). Its terms get a dotted underline in chapter prose and show their definition on hover. A repository without one gets one: the first session writes `.code-guide/glossary.md` in the background, and later sessions reuse it. Add your own `glossary.md` and Code Guide uses that instead.
- **Diff** (for changes): every changed file, like a pull request. **Full diff** shows every line of every file instead of just the changes.
- **Quiz**: 3–5 multiple-choice questions on the guide. Each answer explains itself and cites the code.
- **Trace**: a debugger-style walk through one scenario's path, hop by hop across files, without running anything. Pick a scenario (<kbd>1</kbd>–<kbd>3</kbd>), then step over, into and out of calls (<kbd>F10</kbd>, <kbd>F11</kbd>, <kbd>⇧</kbd><kbd>F11</kbd>, or <kbd>N</kbd>, <kbd>I</kbd>, <kbd>O</kbd>; <kbd>P</kbd> goes back). Values show inline on the lines just run and on hover elsewhere; inferred ones are marked ≈, values read from the code are plain, and a note at the top says they may not be exactly right. Branches the scenario doesn't take are collapsed with the reason. The call stack builds up as you step, with returned calls left faded; click any block to jump to its step. In a narrow slot, Code and Stack become tabs.
- **Chat**: ask about the code as you read. It knows the subject and the finished guides, quizzes and traces. It follows a reply as it streams in, until you scroll up to reread; scroll back down, or send a message, to follow again. **Ask** on a chapter or a trace step brings it in; so does selecting lines in the Guide, Trace or Diff, or prose in the Guide, and choosing **Ask about this** (or <kbd>⌘</kbd><kbd>L</kbd> / <kbd>Ctrl</kbd><kbd>L</kbd>).
- **Citations** (`file:line` chips in Chat, Quiz and the Overview) jump an open Trace to the step at those lines, or show them in the Guide if the current chapter has the file (whichever panel you used last first), else in the Diff, else in a file view.
- **Maximize** a panel to send its neighbor to the dock; restoring it brings the neighbor back.

The layout, Reviewed marks and the Full diff toggle are saved in your browser, per session.

### Sessions

Each session is a folder in `.code-guide/sessions/` in the repository: `events.jsonl`, the session's complete record (see the [event protocol](docs/protocol.md)), and the finished results in `results/`. Code Guide never edits `.gitignore`; add `.code-guide/` to it if you like.

### Settings

`~/.code-guide/settings.json` holds your defaults. A repository's `.code-guide/settings.json` overrides them key by key, and flags override both. Every key is optional:

```json
{
  "harness": "claude",
  "model": "claude-opus-5-5",
  "reviewModel": "claude-sonnet-5-5",
  "modules": ["guide", "chat"],
  "theme": "system",
  "port": 4646,
  "open": true
}
```

`modules` are the panels a new session opens, left slot first; a third and later wait in the dock. Choose from `overview`, `guide`, `quiz`, `trace`, `diff` and `chat`. `theme` is `light`, `dark` or `system`. `reviewModel` defaults to `model`, and `model` to `claude-opus-5-5` with Claude Code. An invalid settings file stops `code-guide` with the file and the problem named.

## Develop

```sh
npm install          # also builds dist/
npm run check        # typecheck, format check, tests
npm run build        # dist/ui (Vite) + dist/cli.js (tsup)

# Live UI development: run the API, then Vite with a proxy to it
node dist/cli.js --no-open --port 4646 &
npm run dev
npm run dev:server   # rebuilds dist/cli.js on change; restart the API to pick it up
```

`CODE_GUIDE_LIVE=1 npm test` also runs the tests that talk to a real Claude model (`CODE_GUIDE_MODEL` to choose one); they take minutes. `--harness fake` is the scripted harness those tests otherwise use; it doesn't write guides.

Layout:

- `src/shared`: the guide schema, prose parsing, the event protocol, and the rules for when a module can open, used by server and browser alike.
- `src/server`: the CLI, sessions, the job runner, chat, harness adapters (`harness/`), git, validation and highlighting.
- `src/modules`: one folder per module, with its job in `module.ts` and its panel in `panel.tsx`, registered in `index.ts`.
- `src/ui`: the workspace (React + Tailwind).

This repo has a guide about itself in `.code-chapters/how-anchors-work.json`; `code-guide check` validates it.
