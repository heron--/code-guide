import { z } from "zod";
import type { Guide, Problem } from "../../shared/guide.js";
import { LIMITS } from "../../server/resolve.js";
import { glossaryNote } from "../../server/glossary.js";
import type { JobContext, JobKind } from "../../server/jobs.js";
import { instructions as guideInstructions, prompt as guidePrompt } from "./instructions.js";
import { submitGuide } from "./submit.js";

/** The quality bar a review judges against: what the spec's checks can't see. */
export const QUALITY_BAR = {
  "one-idea": "Each chapter holds one idea, and its title states that idea.",
  brief: `Every word earns its place: chapters read in under 30 seconds (${LIMITS.bodyWords} words is a ceiling, not a target), the answer stands on its own.`,
  grounded: "Every claim about code is anchored to code the chapter shows, and the excerpt shows what the claim needs.",
  accurate: "Every claim is true of the code: what it does, not what its names suggest.",
  ordered: "Each chapter builds on the ones before it, and the last lands on the answer.",
  selective: "Nothing the reader doesn't need to understand the answer: no plumbing, renames or routine tests.",
  complete: "Nothing the reader does need is missing.",
} as const;

const rules = Object.keys(QUALITY_BAR) as [keyof typeof QUALITY_BAR, ...(keyof typeof QUALITY_BAR)[]];

export const reviewSchema = z.object({
  verdict: z.enum(["accept", "revise"]).describe('"revise" only if a finding would change what the reader takes away'),
  findings: z.array(
    z.object({
      /** 0-based; omit for the guide as a whole. */
      chapter: z.number().int().nonnegative().optional().describe("0-based chapter index; omit for the whole guide"),
      rule: z.enum(rules),
      problem: z.string().min(1).describe("What's wrong, specifically"),
      fix: z.string().min(1).describe("What to do instead, specifically"),
    }),
  ),
});
export type Review = z.infer<typeof reviewSchema>;

const bar = Object.entries(QUALITY_BAR)
  .map(([rule, text]) => `- ${rule}: ${text}`)
  .join("\n");

/** The guide a review or revision job reads: its only guide input. */
function inputGuide(ctx: JobContext): Guide {
  const guides = Object.values(ctx.inputs).filter((r): r is Guide => !!(r as Guide)?.chapters);
  if (guides.length !== 1) throw new Error("expected exactly one guide input");
  return guides[0];
}

function inputReview(ctx: JobContext): Review {
  const reviews = Object.values(ctx.inputs).filter((r): r is Review => !!(r as Review)?.verdict);
  if (reviews.length !== 1) throw new Error("expected exactly one review input");
  return reviews[0];
}

export const reviewJob: JobKind = {
  kind: "review",
  label: "Reviewing the guide",
  instructions: `You review a guide: brief chapters that explain code, each one idea next to the code that proves it. You didn't write it and don't know how it was written. Judge it only against the code and this quality bar:

${bar}

Read the code each chapter cites, and the code around it, before judging. Check every claim. A guide that already passed the spec's mechanical checks can still fail every rule above.

Findings are specific and actionable: which chapter, which rule, what's wrong, and what to do instead. Don't pad: no findings for taste, and no praise. Say "revise" only if a finding would change what the reader takes away; otherwise say "accept", with any small findings.`,
  prompt: (ctx) =>
    `Review this guide. Its author was asked:\n\n> ${guidePrompt(ctx.subject)}\n\nThe guide:\n\n${JSON.stringify(inputGuide(ctx), null, 2)}`,
  submit: {
    tool: "submit_review",
    description: "Submit the review: a verdict and specific findings, each tied to a chapter and a quality-bar rule.",
    input: reviewSchema,
    async validate(input, ctx) {
      const parsed = reviewSchema.safeParse(input);
      if (!parsed.success)
        return {
          problems: parsed.error.issues.map((i): Problem => ({
            level: "error",
            where: i.path.join(".") || "review",
            message: i.message,
          })),
        };
      const chapters = inputGuide(ctx).chapters.length;
      const problems: Problem[] = [];
      parsed.data.findings.forEach((f, i) => {
        if (f.chapter !== undefined && f.chapter >= chapters)
          problems.push({
            level: "error",
            where: `findings[${i}]`,
            message: `the guide has only ${chapters} chapters`,
          });
      });
      if (parsed.data.verdict === "revise" && !parsed.data.findings.length)
        problems.push({ level: "error", where: "findings", message: '"revise" needs at least one finding' });
      return { problems, result: parsed.data };
    },
  },
};

/** A guide job that revises a reviewed guide. It reads the guide and the review, never the earlier transcripts. */
export const revisionJob: JobKind = {
  kind: "guide",
  label: "Revising the guide",
  instructions: `${guideInstructions}

# Revising

You're revising a guide that a reviewer found wanting. You get the guide and the review's findings. Address every finding: check it against the code first, and if the reviewer is wrong about the code, keep what's right. Keep what works; this isn't a rewrite. Submit the whole revised guide.`,
  prompt: (ctx) => {
    const findings = inputReview(ctx)
      .findings.map(
        (f) =>
          `- ${f.chapter === undefined ? "Guide" : `Chapter ${f.chapter}`} (${f.rule}): ${f.problem} Fix: ${f.fix}`,
      )
      .join("\n");
    return `Revise this guide. It was written for this task:\n\n> ${guidePrompt(ctx.subject)}\n\nThe guide:\n\n${JSON.stringify(inputGuide(ctx), null, 2)}\n\nThe review's findings:\n${findings}${glossaryNote(ctx.repo)}`;
  },
  submit: submitGuide,
};
