# Glossary

Four terms. Use these words, and only these words, for these ideas: in the spec, the skill, the viewer, issues, and conversation.

| Term | Definition | Not to be confused with |
| --- | --- | --- |
| **Guide** | The complete answer to one question about a codebase (or one change to it): a title, the question, a short answer, and an ordered list of chapters. | A "tour", "walkthrough" or "doc". A guide answers one question; it is not general documentation. |
| **Chapter** | One idea, stated in a short title and a few sentences, shown next to the code that proves it. A guide is read one chapter at a time. | A "section", "step" or "page". If it holds two ideas, it is two chapters. |
| **Excerpt** | One file shown with a chapter, narrowed to the lines that matter. For a change it shows the diff; for a question it shows the existing code. Everything else in the file is collapsed, not removed. | A "snippet". An excerpt always points at a real file in the repository; it never contains pasted code. |
| **Anchor** | A link in chapter prose to one line or a range of lines inside one of that chapter's excerpts. Clicking it scrolls the code to those lines. | A plain hyperlink. An anchor can only point at code the chapter shows. |
