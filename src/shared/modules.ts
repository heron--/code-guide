import type { Subject } from "./protocol.js";
import type { SessionState } from "./state.js";

/** What the browser knows about a module: enough to show it in the dock and decide whether it can open. */
export type ModuleInfo = {
  name: string;
  label: string;
  /** SVG path data for a 16×16 stroked icon. */
  icon: string[];
  /** Guide and Quiz run a job before they can open; Chat and Diff open at once. */
  needsJob: boolean;
  /** Subject types it works with; omit for all. */
  subjects?: Subject["type"][];
  /** Job kinds that must have a finished result first, e.g. a quiz needs a guide. */
  results?: string[];
};

/** Why a module can't start yet, or undefined when it can. Server and browser use the same rule. */
export function unavailable(m: ModuleInfo, state: SessionState): string | undefined {
  const subject = state.subject?.subject;
  if (!subject) return "Choose a subject first";
  if (m.subjects && !m.subjects.includes(subject.type)) return `${m.label} needs a ${m.subjects.join(" or ")}`;
  for (const kind of m.results ?? []) {
    // One still being written, reviewed or revised: wait, so the input is the final one.
    const newest = state.jobOrder.findLast((id) => state.jobs[id].kind === kind);
    if (newest && moduleBusy(state, state.jobs[newest].module)) return `${m.label} waits for the ${kind} to finish`;
    if (!latestDone(state, kind)) return `${m.label} needs a finished ${kind}`;
  }
  return undefined;
}

/**
 * The newest done job of a kind: finished, and so are the follow-ups its module ran on it (a guide's review,
 * and any revision and its review). Readers never see a result that's still being reviewed, or whose review
 * failed: that shows as the failed job, with its reason and a retry.
 */
export function latestDone(state: SessionState, kind: string): string | undefined {
  return state.jobOrder.findLast((id) => state.jobs[id].kind === kind && done(state, id));
}

function done(state: SessionState, id: string): boolean {
  const job = state.jobs[id];
  return (
    job.status === "finished" &&
    state.jobOrder.every((f) => {
      const next = state.jobs[f];
      return next.module !== job.module || next.inputs[0] !== id || retried(state, f) || done(state, f);
    })
  );
}

/** A failed or cancelled job that was run again: its retry, a later job of the same kind and inputs, counts instead. */
function retried(state: SessionState, id: string): boolean {
  const job = state.jobs[id];
  if (job.status !== "failed" && job.status !== "cancelled") return false;
  const same = (o: typeof job) =>
    o.kind === job.kind && o.module === job.module && o.inputs.join() === job.inputs.join();
  return state.jobOrder.slice(state.jobOrder.indexOf(id) + 1).some((o) => same(state.jobs[o]));
}

/** Whether any of a module's jobs (its own, or follow-ups like a review) is still queued or running. */
export function moduleBusy(state: SessionState, module: string): boolean {
  return state.jobOrder.some(
    (id) => state.jobs[id].module === module && ["queued", "running"].includes(state.jobs[id].status),
  );
}
