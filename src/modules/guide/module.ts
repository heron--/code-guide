import type { SessionState } from "../../shared/state.js";
import { defineModule } from "../types.js";
import { instructions, prompt } from "./instructions.js";
import { reviewJob, revisionJob, type Review } from "./review.js";
import { submitGuide } from "./submit.js";

/** Revisions after the first guide. When they run out, the reader gets the latest valid guide. */
export const MAX_REVISIONS = 1;

/** How many revisions led to a guide: 0 for one written from scratch. A revision's first input is its guide. */
function revisions(state: SessionState, guide: string): number {
  const prev = state.jobs[guide]?.inputs[0];
  return prev && state.jobs[prev]?.kind === "guide" ? 1 + revisions(state, prev) : 0;
}

export default defineModule({
  name: "guide",
  label: "Guide",
  icon: ["M3 3h7l3 3v7H3z", "M5.5 7h5M5.5 9.5h5M5.5 12h3"],
  startsWithSession: true,
  maxJobs: 2 * (1 + MAX_REVISIONS),
  job: {
    kind: "guide",
    label: "Writing the guide",
    instructions,
    prompt: (ctx) => prompt(ctx.subject),
    submit: submitGuide,
  },
  // Every guide is reviewed by a separate job before the reader sees it; "revise" starts a revision.
  next(done, state) {
    if (done.kind === "guide") return { job: reviewJob, inputs: [done.job] };
    const reviewed = state.jobs[done.job].inputs[0];
    if (
      done.kind === "review" &&
      (done.result as Review).verdict === "revise" &&
      revisions(state, reviewed) < MAX_REVISIONS
    )
      return { job: revisionJob, inputs: [reviewed, done.job] };
    return undefined;
  },
});
