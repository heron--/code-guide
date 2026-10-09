# Glossary

Use these words, and only these words, for these ideas: in the spec, the skill, the app, issues, and conversation. The glossary holds only terms that are overloaded or specific to this project.

"Code Guide" is the product, and is always written in full. "guide" alone means the Guide term below.

A module can have its own glossary, `src/modules/<name>/GLOSSARY.md`, in the same format, for terms that name only that module's ideas, wherever those come up (its code and panel, and e.g. Chat asking about a trace step). The same rules apply there.

**Adding, removing or redefining a term requires the project owner's approval.** Propose the change (in an issue or PR comment) and wait for a yes before editing this file or using a new term in the spec, skill or viewer.

| Term | Definition | Not to be confused with |
| --- | --- | --- |
| **Guide** | The complete answer to one question about a codebase (or one change to it): a title, the question, a short answer, and an ordered list of chapters. | A "tour", "walkthrough" or "doc". A guide answers one question; it is not general documentation. |
| **Chapter** | One idea, stated in a short title and a few sentences, shown next to the code that proves it. A guide is read one chapter at a time. | A "section", "step" or "page". If it holds two ideas, it is two chapters. |
| **Excerpt** | One file shown with a chapter, narrowed to the lines that matter. For a change it shows the diff; for a question it shows the existing code. Everything else in the file is collapsed, not removed. | A "snippet". An excerpt always points at a real file in the repository; it never contains pasted code. |
| **Anchor** | A link in chapter prose to one line or a range of lines inside one of that chapter's excerpts. Clicking it scrolls the code to those lines. | A plain hyperlink. An anchor can only point at code the chapter shows. |
| **Subject** | What a session is about: a change, a path, or a question. | An anchor. An anchor points at lines; the subject is the whole thing being explained. |
| **Session** | One run of Code Guide on one subject. Short-lived and disposable. | A harness's own session. One Code Guide session may run several. |
| **Module** | One way of working with the subject in Code Guide: Guide, Quiz, Chat, Diff, or Overview. Shown in a panel. | A panel, which is the window a module appears in. Also not a Go or JavaScript module; when the code's modules come up, say "Go module" or "package." |
| **Job** | Background agent work that produces one result and ends when it passes validation. | Chat. A job has one goal and no back-and-forth with the reader. |
| **Review** | A judgment of a guide against the quality bar, made by a separate job that sees only the guide and the code. | Code review, and validation. Validation checks the spec mechanically; review judges quality. |
| **Console** | What Code Guide prints in the terminal while a session runs: the version, the URL, a log of finished and failed jobs, and a live block with the chat's agent and each running job. | The browser workspace, and a harness's own terminal UI. |
