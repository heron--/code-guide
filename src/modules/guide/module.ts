import type { Subject } from "../../shared/protocol.js";
import { submitGuide } from "../../server/guide-submission.js";
import { defineModule } from "../types.js";

function prompt(subject: Subject): string {
  switch (subject.type) {
    case "change":
      return `Write a guide to the change from the merge-base of \`${subject.base}\` to ${subject.head ? `\`${subject.head}\`` : "the working tree"}. Question: What does this change do, and why?`;
    case "path":
      return `Write a guide to \`${subject.path}\`. Question: How does ${subject.path} work?`;
    case "question":
      return `Write a guide that answers this question about the repository: ${subject.question}`;
  }
}

export default defineModule({
  name: "guide",
  label: "Guide",
  icon: ["M3 3h7l3 3v7H3z", "M5.5 7h5M5.5 9.5h5M5.5 12h3"],
  job: {
    kind: "guide",
    // Replaced by the authoring skill's guidance in DEV-78.
    instructions:
      "You write guides: brief, ordered chapters that each state one idea next to the code that proves it. " +
      "Read the code before writing; never guess. You can't edit files.",
    prompt: (ctx) => prompt(ctx.subject),
    submit: submitGuide,
  },
});
