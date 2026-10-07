# Guide spec — `code-chapters/v1`

A **guide** is one JSON file. It answers one question about a repository, in a few short **chapters**. Each chapter pairs a few sentences of prose with **excerpts** (files narrowed to line ranges). Prose links to exact lines with **anchors**. Terms are defined in the project glossary.

Guides never contain code. They point at files in the repository; the viewer reads the code from git when the guide is opened.

## Where guides live

`<repo root>/.code-chapters/<slug>.json`, where `<slug>` is kebab-case, e.g. `.code-chapters/how-retries-work.json`. Running `code-chapters` anywhere inside the repo lists them.

## Shape

```json
{
  "spec": "code-chapters/v1",
  "title": "Consume explicit lineage facets",
  "question": "What does the lineage-facet branch change, and why?",
  "subject": { "type": "change", "base": "main", "head": "feature/lineage-facet" },
  "answer": "Jobs can now declare their own lineage. When they do, it replaces inferred lineage; when they don't, nothing changes.",
  "chapters": [
    {
      "title": "Define the lineage facet",
      "body": "A new edge type separates job data flow from execution triggers in [the edge contract](proto/api.proto#L230-L234).\n\nThe parser decodes `job.facets.lineage` into [a typed value](lib/jobfacet.go#L16).",
      "excerpts": [
        { "path": "proto/api.proto" },
        { "path": "lib/jobfacet.go", "lines": ["13-19", "69-72"] }
      ]
    }
  ]
}
```

### Guide fields

| Field | Required | Rules |
| --- | --- | --- |
| `spec` | yes | Exactly `"code-chapters/v1"`. |
| `title` | yes | ≤ 8 words. Names the topic, not the process ("Request retries", not "Understanding how request retries work"). |
| `question` | yes | The reader's question, in their words. For a change with no question, write the question a reviewer would ask ("What does this branch change, and why?"). |
| `subject` | yes | What the guide is about: a question or a change. See below. |
| `answer` | yes | 1–2 sentences, ≤ 50 words. The answer to `question`, before any chapter. If the reader stops here, they should still have the gist. |
| `chapters` | yes | 1–7 chapters, in reading order. |

### `subject`

- **Question about existing code:** `{ "type": "question", "ref": "<commit/branch/tag>" }`. `ref` is optional; omit it to read the working tree. Pin a commit when you can, so the guide stays accurate as the code moves.
- **Change:** `{ "type": "change", "base": "<ref>", "head": "<ref>" }`. The viewer diffs from the merge-base of `base` and `head` to `head` (like a pull request). Omit `head` to diff the merge-base against the working tree (uncommitted work).

### Chapter fields

| Field | Required | Rules |
| --- | --- | --- |
| `title` | yes | 2–6 words, sentence case, no trailing period. States the chapter's one idea, usually as a verb phrase ("Separate job data flow"). |
| `body` | yes | 1–3 short paragraphs separated by a blank line, ≤ 70 words total. Supports inline `` `code` `` and anchors. No headings, lists, bold, or code blocks. |
| `excerpts` | yes | 1–4 excerpts. The code the reader needs to believe the body, and nothing else. |

### Excerpt fields

| Field | Required | Rules |
| --- | --- | --- |
| `path` | yes | Repository-relative path, `/`-separated, no leading `./`. Must exist at the subject's ref (for a change: at `head`, or at the merge-base if the file was deleted). |
| `lines` | question: yes · change: no | Line ranges to show, as strings: `"42"` or `"42-60"`. 1-based, inclusive, ascending, non-overlapping. Other lines are collapsed (expandable). For a change, omitting `lines` shows every changed hunk in the file. |

Keep the total shown lines per chapter under ~80. If you need more, the chapter has more than one idea.

### Line numbers

For a change, line numbers are **head-side** (the new file), the numbers a reader sees on the right of a diff. A range also shows the deleted lines that sit between or immediately before its new lines. For a deleted file, use the old file's numbers.

### Anchors

An anchor is a Markdown link in `body`:

```
[link text](<excerpt path>#L<start>)
[link text](<excerpt path>#L<start>-L<end>)
```

- `<excerpt path>` must exactly equal the `path` of one of **this chapter's** excerpts.
- Lines must exist in that file. They should fall inside the excerpt's `lines` (a warning otherwise; the viewer expands collapsed code to reach them).
- Link text is a noun phrase from the sentence ("the edge contract"), never a file name or "here".
- Aim for at least one anchor per chapter. Every claim about code should be one click from that code.

## Validation

`code-chapters check <guide.json>` reports:

- **Errors** (the guide will not render correctly): schema violations, unknown refs, missing files, line numbers out of bounds, anchors to files the chapter doesn't show.
- **Warnings** (the guide breaks the quality bar): length limits, too many chapters or excerpts, chapters with no anchors, anchors outside the excerpt's lines, oversized excerpts.

A guide is done when `check` reports no errors and no warnings.
