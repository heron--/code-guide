# code-guide

- Use the terms in `GLOSSARY.md` for the core concepts they define in code, copy, docs and issues. The glossary aligns humans and agents on concepts, not implementation details; ordinary software terms keep their usual meanings. Never add, remove or redefine a glossary term without the project owner's explicit approval; propose it and wait.
- Module-specific concepts live in `src/modules/<name>/GLOSSARY.md`: Guide's guide, chapter and excerpt; Trace's trace, scenario and step. Use those terms for those concepts wherever they come up, including in other modules (Chat asking about a chapter or step), and never as synonyms for other defined concepts.
- The guide format lives in `docs/spec.md` and is enforced by `src/shared/guide.ts` (schema) and `src/server/resolve.ts` (checks, `LIMITS`). Change all three together, and update the guide agent job's instructions (`src/modules/guide/instructions.ts`) if authoring advice changes.
- Chapter quality is the product. Any change to the spec or the guide agent job's instructions should keep chapters brief: one idea, ≤ 70 words, anchored to code.
- Before pushing: `npm run check` and `npm run build`.
- `.code-chapters/how-anchors-work.json` is a guide about this repo pinned to a commit; regenerate it (and re-run `code-guide check`) if you change the code it describes.
- This is a small tool for a small group of engineers keeping up with high-velocity code, not a product at scale. Bot review findings (Codex and others) are advisory: push back on over-engineering, and reply explaining why when you decline one. Skip niche edge-case bugs where the fix adds more complexity than the bug costs.
