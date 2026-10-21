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
  /** The kind of job whose result the panel shows, for modules with a job. */
  kind?: string;
  /** The kind of job the reader starts by picking an option from that result, e.g. a trace of one scenario. */
  pickKind?: string;
  /** Its panel shows its own jobs' progress and failures, so it opens as soon as its job starts. */
  showsProgress?: boolean;
  /** Subject types it works with; omit for all. */
  subjects?: Subject["type"][];
  /** Job kinds that must have a finished result first, e.g. a quiz needs a guide. */
  results?: string[];
  /** The most jobs one run can take, follow-ups included (today a guide's: write, review, revise, review again). */
  maxJobs?: number;
};

/** Why a module can't start yet, or undefined when it can. Server and browser use the same rule. */
export function unavailable(m: ModuleInfo, state: SessionState): string | undefined {
  const subject = state.subject?.subject;
  if (!subject) return "Choose a subject first";
  if (m.subjects && !m.subjects.includes(subject.type)) return `${m.label} needs a ${m.subjects.join(" or ")}`;
  for (const kind of m.results ?? []) {
    // One that isn't done yet (still being written, or a follow-up is running): wait for the final one.
    const newest = state.jobOrder.findLast((id) => state.jobs[id].kind === kind);
    if (newest && moduleBusy(state, state.jobs[newest].module)) return `${m.label} waits for the ${kind} to finish`;
    if (!latestDone(state, kind)) return `${m.label} needs a finished ${kind}`;
  }
  return undefined;
}

/**
 * Why a module can't start another job now: one of its jobs is still queued or running. The reader cancels it
 * first, so a second run never races the first. Server and browser use the same rule.
 */
export function jobRunning(m: Pick<ModuleInfo, "name" | "label">, state: SessionState): string | undefined {
  return moduleBusy(state, m.name) ? `${m.label} already has a job running; cancel it first` : undefined;
}

/** A module's queued and running jobs: what its Cancel stops. */
export function activeJobs(state: SessionState, module: string): string[] {
  return state.jobOrder.filter(
    (id) => state.jobs[id].module === module && ["queued", "running"].includes(state.jobs[id].status),
  );
}

/**
 * The newest done job of a kind: finished, and so are all the follow-ups its module ran on it (today, a guide's
 * review and any revision). Readers never see an unfinished result, whatever job is left: a failed job shows
 * instead, with its reason and a retry. A job the reader started by picking from a result (a trace of one of its
 * scenarios) isn't a follow-up: the result stays done while it runs.
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
      return (
        next.module !== job.module ||
        next.inputs[0] !== id ||
        next.pick !== undefined ||
        retried(state, f) ||
        done(state, f)
      );
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

/**
 * The newest result a module has to show, of the kind its panel opens with or the kind the reader picks (a trace,
 * after its scenarios). A newer one than its panel last showed marks its dock square ready.
 */
export function latestResult(m: ModuleInfo, state: SessionState): string | undefined {
  const done = [m.kind, m.pickKind].flatMap((k) => (k ? [latestDone(state, k)] : [])).filter((j) => j !== undefined);
  return done.sort((a, b) => state.jobOrder.indexOf(a) - state.jobOrder.indexOf(b)).at(-1);
}

/** Whether any of a module's jobs (its own, or its follow-ups) is still queued or running. */
export function moduleBusy(state: SessionState, module: string): boolean {
  return activeJobs(state, module).length > 0;
}
