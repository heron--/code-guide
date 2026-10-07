import type { SessionState } from "../../shared/state.js";
import { defineModule } from "../types.js";
import { instructions, prompt } from "./instructions.js";
import { reviewJob, revisionJob, type Review } from "./review.js";
import { submitGuide } from "./submit.js";

/** Revisions after the first guide. When they run out, the reader gets the latest valid guide. */
export const MAX_REVISIONS = 1;

const guides = (state: SessionState) =>
  state.jobOrder.filter((id) => state.jobs[id].kind === "guide" && state.jobs[id].status === "finished");

export default defineModule({
  name: "guide",
  label: "Guide",
  icon: ["M3 3h7l3 3v7H3z", "M5.5 7h5M5.5 9.5h5M5.5 12h3"],
  startsWithSession: true,
  job: { kind: "guide", instructions, prompt: (ctx) => prompt(ctx.subject), submit: submitGuide },
  // Every guide is reviewed by a separate job before the reader sees it; "revise" starts a revision.
  next(done, state) {
    if (done.kind === "guide") return { job: reviewJob, inputs: [done.job] };
    if (done.kind === "review" && (done.result as Review).verdict === "revise" && guides(state).length <= MAX_REVISIONS)
      return { job: revisionJob, inputs: [state.jobs[done.job].inputs[0], done.job] };
    return undefined;
  },
});
