---
name: code-chapters
description: Write a guide that answers a question about a codebase ("how does X work?", "why do we use Y here?") or explains a change (a branch, PR, or uncommitted diff) as a few brief chapters, each paired with the exact code it is about. Use when the user asks to explain, walk through, guide, or teach some code or a change, or asks for code chapters.
---

# Code Chapters: write a guide

You will produce one **guide**: a JSON file that answers the user's question in a few short **chapters**. Each chapter states one idea in a few sentences, shown next to **excerpts** of the real code, with **anchors** linking phrases to exact lines. The reader steps through chapters one at a time in the Code Chapters viewer.

The file format is in [SPEC.md](SPEC.md), next to this file. Read it before writing.

**The guide is only as good as its chapters, and good chapters are brief.** A reader should finish a chapter in under 30 seconds and come away with exactly one idea they didn't have before. Everything below serves that.

## 1. Pin down the question and the subject

- **A question about existing code** ("how does auth work?", "why are modules used here?"): `subject.type = "question"`. Set `ref` to the current commit (`git rev-parse HEAD`) unless the working tree has uncommitted changes to the files you'll cite; then omit `ref`.
- **A change** ("explain this branch", "walk me through PR 123", "what did I change?"): `subject.type = "change"`. `base` is the branch it will merge into (usually `main`); `head` is the branch. Omit `head` for uncommitted work.
- Record the question in the user's own words. If they gave no question (just "explain this branch"), use "What does this change do, and why?".

Do not ask the user clarifying questions unless the request is truly ambiguous (e.g. two unrelated features share the name). Make a reasonable call and state it in `answer`.

## 2. Investigate until you can answer in two sentences

Read the code; do not guess from names.

- **Question:** find the entry point the reader would start from (route, CLI command, exported function, config key). Trace the real path the question is about, end to end. Note the 3–6 places where something decisive happens; those are your chapter candidates. Ignore plumbing that does what its name says.
- **Change:** `git diff --stat <merge-base>..<head>` then read the whole diff. Read commit messages and any linked issue for the *why*. Group hunks **by idea, not by file**: one idea often spans a proto, an implementation and a test; one file often holds two ideas.

Then write `answer` (≤ 50 words) **before** any chapter. If you can't, you haven't understood it yet; keep reading.

## 3. Plan chapters as a chain

List the ideas the reader needs, in the order they need them, ending at the answer. Each idea gets one chapter.

- **3–5 chapters is typical; 7 is the hard maximum.** One is fine for a small change.
- **Order by dependency, not by file or by call order.** Introduce a type before the code that uses it; the contract before the implementation; the happy path before edge cases.
- **Cut ruthlessly.** For every planned chapter ask "does the reader need this to understand the answer?" Renames, formatting, import shuffles, generated code, and routine test scaffolding do not get chapters. Tests earn a place only when they show behavior more clearly than the implementation does; then add them as an excerpt in the chapter about that behavior.
- If a chapter needs more than ~80 lines of code shown, it holds more than one idea. Split it or narrow it.

## 4. Write each chapter

**Title:** 2–6 words, verb phrase, sentence case, names the idea. Good: "Separate job data flow", "Retry only idempotent requests". Bad: "Changes to parsing.go", "Overview", "How the retry logic works in the client".

**Body:** 1–3 short paragraphs, ≤ 70 words total. Each paragraph is usually one sentence.

- Lead with the claim: what is true, or what changed. Then, if it's not obvious, *why*.
- Say what the code means, not what it says. The reader can see the code; don't narrate it line by line.
- Anchor the phrase that names the code: `...from execution triggers in [the edge contract](proto/api.proto#L230-L234).` Link text is a noun phrase from the sentence. Never "here", never a bare file name.
- Every claim about code is one anchor away from that code.
- Present tense, active voice, no hedging, no filler ("This chapter explains…", "It's worth noting…", "Basically…"), no bold, no lists.
- Use `` `backticks` `` for identifiers the reader will see in the excerpt.

**Excerpts:** the minimum code the body needs. 1–4 files. For a question, give tight `lines` ranges around the decisive lines (include the enclosing signature line if it helps orientation). For a change, omit `lines` when the whole file diff belongs to this chapter; give `lines` when only part of it does. A file may appear in several chapters with different ranges.

### Example

Bad (narrates, two ideas, no anchors, 90+ words):

> **Changes to parsing and the proto**
> In this chapter we look at the changes made to parsing.go and api.proto. First, in api.proto, a new enum value called EDGE_TYPE_JOB_DATA_FLOW has been added with the value 4005, along with a comment. Then in parsing.go, the jobEventTags function has been updated so that instead of only skipping the "sql" key, it now also skips the lineage facet type. A test has also been added to verify this behavior works correctly…

Good (one idea each, anchored, ~30 words each):

> **Separate job data flow**
> A new graph edge distinguishes data moving between jobs from scheduling dependencies in [the edge contract](domains/ugp/shared/libs/proto/api/api.proto#L230-L234).

> **Keep lineage out of tags**
> The parser drops lineage payloads from flattened job tags, alongside SQL, to avoid [high-cardinality tags](domains/data_observability/libs/openlineage-processing/parsing.go#L93-L94).

## 5. Check, then cut

1. Save to `<repo root>/.code-chapters/<slug>.json` (create the directory if needed).
2. Run `code-chapters check .code-chapters/<slug>.json`. Fix every error and every warning, then run it again. If the `code-chapters` command isn't installed, check each rule in SPEC.md by hand: paths exist at the ref, line numbers are in bounds, every anchor path matches one of its chapter's excerpts exactly.
3. Brevity pass. Reread each chapter and delete every word, clause and sentence the reader doesn't need. Then do it once more. Then reread the guide start to finish: does each chapter follow from the last, and does the last one land on the answer?

## 6. Hand off

Tell the user, in two or three lines: the guide's path, how many chapters, and to open it by running `code-chapters` from inside the repo. Don't repeat the guide's content in chat.
