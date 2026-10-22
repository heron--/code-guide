# Code Guide

Understand unfamiliar code and pull requests without piecing the explanation together yourself. Choose a change, a path, or a question like “how does authentication work?” and Code Guide uses your coding agent to write a **guide**: brief **chapters**, each explaining one idea beside the code that supports it.

Read the explanation, follow links into the code, and ask questions as you go. You can also see the full diff, test your understanding with a quiz, or follow a scenario through the code without running it.

```text
┌ Retry only safe requests ──────────┐ ┌ client.ts  src ──────────────── +23 -10 ┐
│ 02 / 03  ↑ ↓  ☐ Reviewed      Ask  │ │ 10  const IDEMPOTENT = new Set([...]);  │
│                                    │ │ 11  const RETRYABLE = new Set([...]);   │
│ Only idempotent methods get more   │ │ ⇕ 7 unchanged lines                     │
│ than one attempt; a repeated POST  │ │ 31  if (!RETRYABLE.has(res.status) ...  │
│ could double-write.                │ │ 32    log("request failed", ...);       │
│       ┈┈┈┈┈┈┈┈┈┈┈┈ ← anchor        │ │ 33    throw new Error(...);             │
└────────────────────────────────────┘ └─────────────────────────────────────────┘
```

## Install and start

You'll need:

- **Node.js 22.12 or newer** and **git**.
- **Claude Code**, signed in. Run `claude` once to sign in. You can use [pi instead](#use-pi-instead-of-claude-code).
- For pull requests, the **[GitHub CLI](https://cli.github.com/)**, signed in with `gh auth login`. You don't need GitHub authentication to explore local code or branches.

```sh
npm install -g github:heron--/code-guide
code-guide
```

Code Guide opens a browser and a **terminal UI**. Keep the terminal running while you use it.

1. In the browser, choose **Pull requests** or **Local**.
2. Select what you want to understand, then click **Start session**.
3. Wait for the guide to appear, then read its chapters and use **Chat** for follow-up questions.

Opening Code Guide alone doesn't start AI analysis. Choosing a subject and starting a session does.

## Choose what to understand

### A pull request

In **Pull requests**, find a repository, select a PR, and click **Start session**. You can also paste a PR link into the repository search to start directly.

- **Author** defaults to `me`, so you initially see your own PRs. Clear it to include everyone's, or enter another username.
- **State** includes open, closed, and merged PRs by default.
- **Only my repositories** includes repositories you own or collaborate on and your organizations' repositories. Turn it off to search more widely, or enter `owner/repository` directly.

Already have the PR? Skip the browser selection:

```sh
# A link works from any directory
code-guide --pr https://github.com/owner/repository/pull/123

# A number uses the repository in your current directory
code-guide --pr 123
```

PR sessions use a separate temporary checkout, so you don't need to clone the repository or switch your current branch. If new commits arrive while you're reading, **Update modules** appears in the status bar; use it to refresh the guide and overview.

### Local code, a branch, or a question

Choose **Local** and browse to a git repository, or start its file browser at a directory:

```sh
code-guide /path/to/repository
```

The subject inputs are optional:

| What you want to understand | What to enter |
| --- | --- |
| The repository as a whole | Leave all inputs blank. |
| One part of the code | Enter a path such as `src/auth` in **Question or path**. |
| How something works | Enter a question such as “How are retries scheduled?” in **Question or path**. |
| A branch's changes | Enter `feature` or `origin/feature` in **Source branch**. |
| A branch compared with a particular base | Fill in **Source branch** and **Target branch**, such as `feature` and `main`. |
| One concern within a change | Fill in the branches and add a question, such as “What changes for existing users?” |

If you leave **Target branch** blank, Code Guide compares against the repository's default branch. On its own, **Question or path** also accepts a commit range such as `main...feature`.

Click **Start session** when you're ready. Each session has one subject; use **End session** to choose another.

## Read and explore

A session starts with **Guide** on the left and **Chat** on the right. Other modules open from **New panel** or the dock along the bottom. Drag panels to rearrange them, drag the divider to resize, or maximize a panel for more room.

### Follow the guide

Each chapter pairs a short explanation with code excerpts. For a change, those excerpts show the diff; for a question, they show the existing code. Unrelated lines are collapsed so you can focus on what matters.

- **Scroll through the code** or use the chapter arrows. The explanation follows the current chapter.
- **Click an anchor**—a coloured link in the explanation—to highlight the exact lines it refers to. **Go back** returns you to where you were.
- **Mark chapters or files Reviewed** to keep track of your progress. Marking a file also collapses it.
- **Hover over dotted-underlined terms** to see their definitions from the repository's glossary.

With focus in Guide, use **J / K** for the next or previous chapter, **[ / ]** for files, and **R** to mark the chapter Reviewed. Your layout and Reviewed marks are saved in the browser for that session.

### Ask about what you're reading

Chat knows the session's subject and its completed guide, quiz, and traces. Ask a follow-up such as “What happens if this request fails?” or “Where is this value set?”

Use **Ask** on a chapter or trace step to bring it into Chat. You can also select code in Guide, Diff, or Trace—or prose in Guide—and choose **Ask about this**. The shortcut is **⌘L** on macOS or **Ctrl+L** elsewhere.

Answers include clickable `file:line` citations so you can check the code yourself.

### See the subject another way

| Module | Use it to… |
| --- | --- |
| **Overview** | Get a short summary before reading the chapters. For a PR, it also shows the PR description. |
| **Diff** | Read every changed file. Turn on **Full diff** to include all the surrounding code. Available for changes. |
| **Quiz** | Check your understanding with 3–5 multiple-choice questions, explanations, and code citations. Available once the guide is ready. |
| **Trace** | Choose a scenario and follow its path across files, with values and a call stack beside the code. |

Trace is an AI explanation, **not a recorded execution**: it doesn't run your program. Inferred values are marked **≈**. Use its controls to step over, into, or out of calls, and go back whenever you need to reread.

## How it works

Code Guide runs a local browser app and uses Claude Code by default, or pi if you choose it. The agent reads and searches the repository to explain your subject. A guide and overview are prepared when a session starts; quizzes and traces are prepared when you open them. Progress appears in the browser and terminal UI. If something fails, its panel shows the reason and offers **Retry**.

The guide's links and excerpts are checked against the code, and a separate AI review checks the explanation and can request a revision. These checks help, but don't make the explanation infallible: use the anchors and citations to verify important claims.

**The agent cannot edit your source files or run your application.** Its tools are limited to reading and searching repository files and read-only git commands. Code Guide itself fetches commits as needed and saves session data under `.code-guide/`. If the repository has no root `glossary.md`, it also generates `.code-guide/glossary.md` for term definitions.

The browser runs on your machine, but analysis uses your chosen model provider. Treat the code and questions sent to that model according to your provider's data policies; a local browser does not mean offline analysis.

## End a session and manage saved data

**End session** stops the analysis and returns to subject selection. Quitting Code Guide also stops the session. **Closing the browser alone does not stop it.**

Temporary PR checkouts and their session data are deleted by default when the session ends. To keep them, enable **Keep PR checkouts** in the browser's Settings or the terminal UI's settings before ending the session. Local sessions use your existing checkout and never delete it.

**Session history** in the browser or terminal UI lists previous sessions and tells you whether a PR checkout was kept and where it is. Local session records and results live in `.code-guide/sessions/` inside the repository. You can add `.code-guide/` to your `.gitignore`; Code Guide doesn't change it for you.

### Terminal controls

The terminal shows the browser URL, GitHub account, current session, and analysis progress.

| Key | Action |
| --- | --- |
| **o** | Open the browser again. |
| **e** | End the current session. |
| **h** | Show session history. |
| **s** | Open settings; use arrow keys and **Space** to change checkout retention. |
| **q** or **Ctrl+C** | Quit Code Guide and stop the session. |

## Choose an agent and set defaults

### Use pi instead of Claude Code

Sign in to your chosen provider in [pi](https://github.com/badlogic/pi-mono) and select a default model, then run:

```sh
code-guide --harness pi

# Or choose a model explicitly; replace provider/id with your model
code-guide --harness pi --model provider/id
```

With either agent, `--model` chooses the model used for explanations and Chat. `--review-model` optionally chooses a different model for the guide's AI review; otherwise it uses the same model.

### Save your preferences

Create `~/.code-guide/settings.json` to set defaults. For example:

```json
{
  "harness": "claude",
  "modules": ["guide", "chat"],
  "theme": "system",
  "open": true,
  "keepClones": false
}
```

Every setting is optional. `theme` can be `light`, `dark`, or `system`. `modules` chooses what opens at the start of a session: `guide`, `chat`, `overview`, `diff`, `quiz`, or `trace`. The first two appear side by side; any others wait in the dock. You can also set `model`, `reviewModel`, and `port` here.

For Local sessions, `.code-guide/settings.json` inside the repository can override individual defaults. PR sessions use only your user settings. Command-line flags take precedence. `keepClones` is always a user preference, not a repository setting.

## If something isn't working

- **Can't connect to an agent?** Run `claude` to check its sign-in, or sign in and choose a model in pi if using `--harness pi`. The terminal UI shows connection errors.
- **Can't find a repository or PR?** Check the GitHub account shown in the browser or terminal UI, run `gh auth status`, and check the Author and State filters. Set `GH_HOST` when using GitHub Enterprise.
- **Browser didn't open?** Press **o** in the terminal UI or visit the URL it prints. `--no-open` lets you open it yourself. The default port is `4646`, or the next free port; use `--port 5000` to choose another.
- **Not sure which version is installed?** Run `code-guide --version`. To update, run the install command again.

Run `code-guide --help` for the full command-line options.
