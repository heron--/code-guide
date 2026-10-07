import { z } from "zod";
import { guideSchema, SPEC_VERSION, type Guide, type Problem } from "../../shared/guide.js";
import type { Subject } from "../../shared/protocol.js";
import type { JobContext, JobKind } from "../../server/jobs.js";
import { checkGuide } from "../../server/resolve.js";

/** What the agent submits: a guide without `spec` and `subject`, which come from the session. */
export const guideSubmissionSchema = guideSchema.omit({ spec: true, subject: true });

/** The guide's `subject` for a session's subject. Paths and questions read the working tree. */
export function guideSubject(subject: Subject): Guide["subject"] {
  return subject.type === "change"
    ? { type: "change", base: subject.base, ...(subject.head && { head: subject.head }) }
    : { type: "question" };
}

/** `submit_guide`: checks a submitted guide with the same validator as `code-guide check`. */
export const submitGuide: JobKind["submit"] = {
  tool: "submit_guide",
  description:
    "Submit the finished guide. It's checked against the spec: errors are returned for you to fix and resubmit; " +
    "warnings are recorded. Your job ends when a submission is accepted.",
  input: guideSubmissionSchema,
  async validate(input: unknown, ctx: JobContext) {
    const parsed = guideSubmissionSchema.safeParse(input);
    if (!parsed.success) {
      const problems: Problem[] = parsed.error.issues.map((i) => ({
        level: "error",
        where: i.path.join(".") || "guide",
        message: i.message,
      }));
      return { problems };
    }
    const guide: Guide = { spec: SPEC_VERSION, subject: guideSubject(ctx.subject), ...parsed.data };
    const { problems } = await checkGuide(guide, ctx.repo, { id: "submission", file: "submission" });
    return { problems, result: guide };
  },
};

export type GuideSubmission = z.infer<typeof guideSubmissionSchema>;
