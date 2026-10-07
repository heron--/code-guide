import { z } from "zod";
import type { Guide, Problem } from "../../shared/guide.js";
import { fileAt, revParse, splitLines } from "../../server/git.js";
import { prompt as guidePrompt } from "../guide/instructions.js";
import { defineModule } from "../types.js";

export const quizSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        options: z
          .array(z.object({ text: z.string().min(1), correct: z.boolean() }))
          .min(3)
          .max(5),
        explanation: z.string().min(1).describe("One or two sentences: why the correct option is right"),
        cite: z.object({
          path: z.string().min(1).describe("Repository-relative path"),
          lines: z.string().regex(/^\d+(-\d+)?$/, 'like "42" or "42-60"'),
        }),
      }),
    )
    .min(3)
    .max(5),
});
export type Quiz = z.infer<typeof quizSchema>;

const instructions = `You write a short quiz about code a reader has just studied in a guide: 3-5 multiple-choice questions that check they understood it, not that they remember wording. No typing, no trick questions.

- Ask about the ideas the guide teaches: what the code does, why, and what would happen otherwise.
- Every wrong option is a plausible near-miss drawn from the actual code: the file that looks responsible but isn't, the behavior before the change, a neighboring condition. Never filler or jokes.
- Exactly one option is correct. Vary its position.
- The explanation says in one or two sentences why the correct option is right, and if useful why the tempting one is wrong.
- Each question cites a file and line range in the repository that backs the answer. Read those lines before citing them.

You can read files, search, and run read-only git commands. Submit with \`submit_quiz\`; fix any errors it returns and submit again.`;

export default defineModule({
  name: "quiz",
  label: "Quiz",
  icon: ["M2.5 2.5h11v11h-11z", "M5 8.2l2 2 4-4.4"],
  results: ["guide"],
  job: {
    kind: "quiz",
    instructions,
    prompt: (ctx) => {
      const guide = Object.values(ctx.inputs)[0] as Guide;
      return `Write a quiz about this guide. Its author was asked:\n\n> ${guidePrompt(ctx.subject)}\n\nThe guide:\n\n${JSON.stringify(guide, null, 2)}`;
    },
    submit: {
      tool: "submit_quiz",
      description:
        "Submit the quiz: 3-5 questions, each with exactly one correct option, an explanation and a cited line range.",
      input: quizSchema,
      async validate(input, ctx) {
        const parsed = quizSchema.safeParse(input);
        if (!parsed.success)
          return {
            problems: parsed.error.issues.map((i): Problem => ({
              level: "error",
              where: i.path.join(".") || "quiz",
              message: i.message,
            })),
          };
        // Cited lines are read where the reader will see them: the change's head, or the working tree.
        const head = ctx.subject.type === "change" ? ctx.subject.head : undefined;
        const ref = head ? await revParse(ctx.repo, head) : undefined;
        if (head && !ref) return { problems: [{ level: "error", where: "quiz", message: `unknown ref "${head}"` }] };
        const problems: Problem[] = [];
        for (const [i, q] of parsed.data.questions.entries()) {
          const where = `questions[${i}]`;
          const correct = q.options.filter((o) => o.correct).length;
          if (correct !== 1)
            problems.push({ level: "error", where, message: `has ${correct} correct options; it needs exactly 1` });
          const { path, lines } = q.cite;
          const text = path.split("/").includes("..") ? undefined : await fileAt(ctx.repo, ref, path);
          if (text === undefined) {
            problems.push({ level: "error", where: `${where}.cite`, message: `${path} doesn't exist` });
            continue;
          }
          const [start, end = start] = lines.split("-").map(Number);
          const last = splitLines(text).length;
          if (start < 1 || end < start || end > last)
            problems.push({
              level: "error",
              where: `${where}.cite`,
              message: `lines ${lines} aren't in ${path} (${last} lines)`,
            });
        }
        return { problems, result: parsed.data };
      },
    },
  },
});
