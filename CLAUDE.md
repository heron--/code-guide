# code-chapters

- Use only the terms in `GLOSSARY.md` (guide, chapter, excerpt, anchor) in code, copy, docs and issues. Don't introduce synonyms like "section", "step" or "snippet". Never add, remove or redefine a glossary term without the project owner's explicit approval; propose it and wait.
- The guide format lives in `skill/code-chapters/SPEC.md` and is enforced by `src/shared/guide.ts` (schema) and `src/server/resolve.ts` (checks, `LIMITS`). Change all three together, and update `SKILL.md` if authoring advice changes.
- Chapter quality is the product. Any change to the spec or skill should keep chapters brief: one idea, ≤ 70 words, anchored to code.
- Before pushing: `npm run check` and `npm run build`.
- `.code-chapters/how-anchors-work.json` is a guide about this repo pinned to a commit; regenerate it (and re-run `code-chapters check`) if you change the code it describes.
