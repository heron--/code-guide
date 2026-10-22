# Glossary

Use these terms when discussing, building, or using Code Guide. The definitions align humans and agents on the app's core concepts, not implementation details. Ordinary software terms keep their usual meanings.

"Code Guide" is the product, and is always written in full. "guide" alone means the concept defined in the [Guide glossary](src/modules/guide/GLOSSARY.md).

Module-specific concepts live in `src/modules/<name>/GLOSSARY.md`: [Guide](src/modules/guide/GLOSSARY.md) and [Trace](src/modules/trace/GLOSSARY.md). Those definitions apply wherever the concepts come up, including in other modules.

**Adding, removing, or redefining a term requires the project owner's explicit approval.** Propose the change and wait for approval.

| Term | Definition |
| --- | --- |
| **Glossary** | The shared vocabulary that lets humans and agents refer to the same core ideas with the same words. |
| **Module** | A part of Code Guide that offers one way to understand the subject, such as Guide, Chat, or Trace. |
| **Agent job** | A one-shot agent run with a specific goal and an output, such as writing a guide or checking it. |
| **Session** | The shared context for exploring one subject across modules, keeping the generated content and conversation together. |
| **Subject** | The pull request, code, or question a session focuses on. |
| **Anchor** | A link that ties an explanation to the exact code it describes. |
