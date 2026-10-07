import { z } from "zod";
import { malformedLinks, parseBody, wordCount, type Problem } from "../../shared/guide.js";
import { fileAt, revParse, splitLines } from "../../server/git.js";
import { pullRequestFor, type PullRequest } from "../../server/subjects.js";
import { prompt as guidePrompt } from "../guide/instructions.js";
import { defineModule } from "../types.js";

/** Most words in the summary: an intro read in under a minute. */
export const SUMMARY_WORDS = 150;

const submission = z.object({
  summary: z.string().min(1).describe(`1-3 short paragraphs separated by a blank line, at most ${SUMMARY_WORDS} words`),
});

export type Overview = { summary: string; pullRequest?: PullRequest };

const instructions = `You write the overview of what a reader is about to study: a short summary that introduces it before they read a guide's chapters about it. You don't write the chapters; another job does.

- Say what it is and what it's for, then name its main parts or steps in the order a reader meets them. For a change: what it changes and why, and what it leaves alone.
- 1-3 short paragraphs separated by a blank line, at most ${SUMMARY_WORDS} words in all. Plain sentences: no headings, lists, bold or code blocks. Use \`backticks\` for identifiers.
- Read the code before writing; don't guess from names. For a change, read the diff and its commit messages.
- Anchor the phrase that names important code with a Markdown link to exact lines: [the retry check](src/retry.ts#L31-L33). Repository-relative paths. Read those lines before citing them.

You can read files, search, and run read-only git commands. Submit with \`submit_overview\`; fix any errors it returns and submit again.`;

export default defineModule({
  name: "overview",
  label: "Overview",
  icon: ["M2.5 3h11v10h-11z", "M5 6h6M5 8.5h6M5 11h3.5"],
  startsWithSession: true,
  job: {
    kind: "overview",
    label: "Writing the overview",
    instructions,
    prompt: (ctx) => `Write the overview. The reader asked:\n\n> ${guidePrompt(ctx.subject)}`,
    submit: {
      tool: "submit_overview",
      description: `Submit the overview: a summary of at most ${SUMMARY_WORDS} words, with anchors to exact lines.`,
      input: submission,
      async validate(input, ctx) {
        const parsed = submission.safeParse(input);
        if (!parsed.success)
          return {
            problems: parsed.error.issues.map((i): Problem => ({
              level: "error",
              where: i.path.join(".") || "overview",
              message: i.message,
            })),
          };
        const { summary } = parsed.data;
        const problems: Problem[] = [];
        const words = wordCount(summary);
        if (words > SUMMARY_WORDS)
          problems.push({ level: "error", where: "summary", message: `${words} words; at most ${SUMMARY_WORDS}` });
        for (const link of malformedLinks(summary))
          problems.push({ level: "error", where: "summary", message: `${link} isn't a link to lines (path#L1-L2)` });
        // Cited lines are read where the reader will see them: the change's head, or the working tree.
        const head = ctx.subject.type === "change" ? ctx.subject.head : undefined;
        const ref = head ? await revParse(ctx.repo, head) : undefined;
        if (head && !ref) return { problems: [{ level: "error", where: "summary", message: `unknown ref "${head}"` }] };
        for (const a of parseBody(summary).flat()) {
          if (a.kind !== "anchor") continue;
          const text = a.path.split(/[\\/]/).includes("..") ? undefined : await fileAt(ctx.repo, ref, a.path);
          const last = text === undefined ? 0 : splitLines(text).length;
          if (text === undefined)
            problems.push({ level: "error", where: "summary", message: `${a.path} doesn't exist` });
          else if (a.range.start < 1 || a.range.end < a.range.start || a.range.end > last)
            problems.push({
              level: "error",
              where: "summary",
              message: `lines ${a.range.start}-${a.range.end} aren't in ${a.path} (${last} lines)`,
            });
        }
        if (problems.length) return { problems };
        // The pull request's own description, kept with the result so it reads the same later.
        const pullRequest = await pullRequestFor(ctx.repo, ctx.subject);
        const result: Overview = { summary, ...(pullRequest && { pullRequest }) };
        return { problems, result };
      },
    },
  },
});
