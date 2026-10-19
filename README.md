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

Terms are defined in the [glossary](GLOSSARY.md), and a module's own terms in its glossary (Trace's is [here](src/modules/trace/GLOSSARY.md)).

## Install

Requires Node 22.12+, git, and Claude Code signed in (run `claude` once). To use pi instead, sign in to a model in `pi` and run `code-guide --harness pi`, with `--model provider/id` to choose one (otherwise pi's default model).

The default PR selection requires the [GitHub CLI](https://cli.github.com/) (`gh`), signed in with `gh auth login`. Code Guide shows its authenticated account in the browser and console; authentication errors are visible rather than an empty PR list. Local analysis does not require GitHub authentication.

```sh
npm install -g github:heron--/code-guide   # or: git clone … && npm install && npm link
```

## Use

Run `code-guide` from any directory. It opens the console in the terminal and a browser on `127.0.0.1` for choosing a subject, without starting a session or agent work. Choosing one starts a separate session process.

```
code-guide [dir]                   Open the console and the browser; dir opens Local's file browser there
code-guide check <guide.json>…     Validate guides against the spec; exits 1 on errors
code-guide --version               The version and the commit it was built from, e.g. 0.1.0#a1b2c

  --pr <number|link>           start a session on this pull request at once
  --harness <claude|pi|fake>   --model <m>   --review-model <m>    reviews default to --model
  --port <n>                   default 4646, or the next free port after it
  --open / --no-open           open a browser, or don't (default: open)
```

### Pull requests and Local

**Pull requests** is the default. Recently accessed repositories appear first, then your repositories: ones you own or collaborate on, and your organizations' (up to 1000, most recently pushed first). Typing filters them by any part of the name at once. **Only my repositories** (on by default) keeps the list to these; turned off, GitHub-wide search results follow your matches. GitHub's search matches whole words, so it is also used, limited to you and your organizations, when you have more repositories than the list holds. The list shows when it's loading and searching. You can also enter `owner/repository` and press **Use repository**. Selecting a repository populates its PRs in a scrolling list; click a PR to select it, then **Start session** (or double-click it). PR search accepts GitHub search syntax; **Author** defaults to `me` (the authenticated account), can name another author, or can be cleared for anyone. It suggests the repository's contributors and the authors of PRs already listed. **State** defaults to all, including open, closed, and merged PRs. Up to 100 results are shown; narrow the search when needed. `GH_HOST` selects a GitHub Enterprise host.

A PR session uses an isolated temporary checkout, not your current directory. Code Guide fetches the PR's commits with blob filtering and shallow history, deepening only as needed to find the merge-base (up to 4096 commits). Changed files and root-level context are materialized; other code is available to the agent with `git show HEAD:path`. Git LFS content is not downloaded. Repository settings from PR checkouts are not applied. PRs requiring more history can be analyzed with **Local**.

**Local** has a file browser: click a directory to open it, or `../` to go up; files are listed but can't be chosen. The directory can also be typed, with `~` for your home directory. **Start session** is available once the directory shown is inside a git repository. Local also takes an optional source branch, target branch, and question or path. A source without a target compares against the default branch. Leave the subject blank to explain the repository. Local sessions use the existing checkout and never delete it. GitHub authentication is not required.

**End session** returns to PR selection after stopping agent work. Temporary PR checkouts are discarded by default after the session process stops. To retain them, enable **Keep PR checkouts** in the browser's Settings or the console's. Quitting also stops the session and applies this setting; closing the browser alone does not end it.

**Session history** (in the browser below the selection, and the console's history view) lists your sessions, newest first, with whether each PR checkout was kept and is still on disk, and where. It's saved in `~/.code-guide/history.json` (the last 100 sessions). A session the launcher couldn't end cleanly (it was killed) shows as ended unexpectedly; its checkout is left in place.

`--pr <link>` starts a PR session as soon as the console is up, from any directory. `--pr <number>` identifies the repository through `gh` in the supplied directory (or the current one).

### Local subjects

Local offers three optional subject inputs, validated when you press **Start session**:

- **Source**: the branch to explain, as `branch` or `remote/branch`. Without a remote, Code Guide uses the local branch, falling back to origin if it doesn't exist locally.
- **Target**: the branch to compare against, shown only when source is filled in. Without a remote, it uses the local branch. Omit it to use the default branch, as usual. A target without a source is rejected.
- **Question**: focus the explanation of the change, or ask a general question without a source. On its own it also accepts a path, branch, pull request link or number (`#12`), or commit range (`main...feature`).

Leave all three blank to explain the repository. The browser shows progress while checking the inputs and fetching commits, and lets you retry if either fails. A session has one subject; **End session** returns to selection. The status bar names it; a question is named by its guide's title once the guide is written, with the full question on hover.

A change runs from the merge-base of its base and head to its head, or to the working tree when it has no head. Code Guide fetches remote branches first, so a stale local copy doesn't pull other people's commits into the change; offline, it uses the local copy. An explicitly chosen local source or target stays local. For a pull request it fetches the head commit without creating a branch.

When a change comes from a pull request, the status bar links to it (with `gh`). While the subject is the pull request itself, Code Guide checks it every minute; when new commits are pushed, the status bar offers **Update modules**, which moves the session to the latest commit and writes its guide and overview again. A quiz waits for you to start it again, so it isn't built from the old guide.

### Jobs

Choosing a subject starts two jobs: the guide and the overview. Every guide goes to a review job that sees only the guide and the code. If the review asks for changes, one revision is written and reviewed again, and you see the latest guide that passed the spec. The quiz job starts when you open Quiz, once the guide is done. Opening Trace starts a quick job that proposes scenarios; picking one starts the job that writes its trace, step by step, each batch checked against the code as it's written.

A job submits its result through a tool that checks it; errors go back to the agent, which gets 5 submissions to fix them. Two jobs run at a time. The agent can read and search files inside the repository and run single read-only git commands; it can't edit anything. A failed job shows its reason in its panel and dock square, with **Retry**.

### Console

When `code-guide` runs on a terminal, the **console** takes over the screen. Its home view shows the version and the commit it was built from (`-dirty` if the build had uncommitted changes, so you can tell whether your install is up to date), the browser URL, the `gh` account and its status, the running session, and the checkout setting. While a session runs it shows its progress: the chat's agent (harness, model, how full its context is, and whether it's thinking, writing, in a tool call or idle) and a progress bar for each running job. Below is a log of the subject and finished and failed jobs. Color marks what each line means: green for done and authenticated, red for failures, cyan for links and progress. Set `NO_COLOR` to turn it off.

Keys: <kbd>s</kbd> settings, <kbd>h</kbd> session history, <kbd>o</kbd> open the browser (on the running session, if there is one), <kbd>e</kbd> end the session, <kbd>q</kbd> or <kbd>Ctrl</kbd><kbd>C</kbd> quit. In settings, <kbd>↑</kbd>/<kbd>↓</kbd> select and <kbd>Space</kbd> changes and saves the selected setting; <kbd>Esc</kbd> (or **Back**) returns to the previous screen. Quitting stops the session and restores the terminal as it was before `code-guide` started. With output redirected (not a terminal), the console prints status changes and log lines instead and reads no keys.

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

Each session is a folder in `.code-guide/sessions/` in its repository (the temporary checkout for a PR session): `events.jsonl`, the session's complete record (see the [event protocol](docs/protocol.md)), and the finished results in `results/`. Code Guide never edits `.gitignore`; add `.code-guide/` to it if you like.

### Settings

`~/.code-guide/settings.json` holds your defaults. For Local sessions, a repository's `.code-guide/settings.json` overrides them key by key; PR sessions use only user settings. Flags override both. Every key is optional:

```json
{
  "harness": "claude",
  "model": "claude-opus-5-5",
  "reviewModel": "claude-sonnet-5-5",
  "modules": ["guide", "chat"],
  "theme": "system",
  "port": 4646,
  "open": true,
  "keepClones": false
}
```

`keepClones` is a user-only setting: keep or discard temporary PR checkouts after their processes stop. Discarding also removes their session records. Failed checkout preparation is always discarded. Recent repositories are saved separately in `~/.code-guide/repositories.json`. Checkout retention is editable in the browser's or the console's settings. Other defaults can be edited in the JSON file.

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
