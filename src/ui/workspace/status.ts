import { latestDone, moduleBusy, type ModuleInfo } from "../../shared/modules";
import type { JobState, SessionState } from "../../shared/state";

export type PanelState = {
  /** A job of this module (its own, or a follow-up like a review) is queued or running. */
  busy: boolean;
  /** What the busy job is doing. */
  activity?: string;
  /** Which step of the run is going, e.g. "Reviewing guide · step 2 of up to 4". */
  stage?: string;
  /** The job whose result the panel shows. */
  job?: string;
  /** The module's latest job failed, and nothing is running. */
  failed?: JobState;
};

export function panelState(m: ModuleInfo, state: SessionState): PanelState {
  const jobs = state.jobOrder.map((id) => state.jobs[id]).filter((j) => j.module === m.name);
  const busy = moduleBusy(state, m.name);
  const running = jobs.findLast((j) => j.status === "running" || j.status === "queued");
  const last = jobs.at(-1);
  return {
    busy,
    activity: running?.activity,
    stage: running && stageLabel(m, state, running),
    job: m.kind ? latestDone(state, m.kind) : undefined,
    failed: !busy && last?.status === "failed" ? last : undefined,
  };
}

/** What a job is doing, in words: "Writing guide", "Reviewing guide", "Revising guide". */
export function jobLabel(j: JobState): string {
  if (j.kind === "review") return "Reviewing guide";
  if (j.kind === "guide" && j.inputs.length) return "Revising guide";
  return `Writing ${j.kind}`;
}

function stageLabel(m: ModuleInfo, state: SessionState, j: JobState): string {
  const { step, of } = runProgress(m, state);
  return of > 1 ? `${jobLabel(j)} · step ${step} of ${of === step ? of : `up to ${of}`}` : jobLabel(j);
}

/** What went wrong, for a failed job's panel: "Couldn't review the guide". */
export function failedTitle(j: JobState): string {
  if (j.kind === "review") return "Couldn't review the guide";
  if (j.kind === "guide" && j.inputs.length) return "Couldn't revise the guide";
  return `Couldn't write the ${j.kind}`;
}

/**
 * How far along a module's current run is: the jobs it has finished (a guide, its review, …) out of the most it
 * can take, plus a share of the running one, from the work it has reported. It only moves forward; when a review
 * accepts the guide early, the run is simply done.
 */
export function runProgress(m: ModuleInfo, state: SessionState): { step: number; of: number; fraction: number } {
  const jobs = state.jobOrder.map((id) => state.jobs[id]).filter((j) => j.module === m.name);
  // A run starts with a job that doesn't follow up another of the module's jobs.
  const start = jobs.findLastIndex((j) => !jobs.some((p) => p.id === j.inputs[0]));
  const run = jobs.slice(Math.max(start, 0));
  const finished = run.filter((j) => j.status === "finished").length;
  const current = run.find((j) => j.status === "running");
  const share = current ? 1 - Math.exp(-current.steps / 12) : 0;
  const of = Math.max(m.steps ?? 1, finished + 1);
  return { step: finished + 1, of, fraction: (finished + 0.9 * share) / of };
}

/** What the session is doing, for the status bar: "Writing guide…", "Reviewing guide…". */
export function sessionActivity(state: SessionState): string | undefined {
  const j = state.jobOrder.map((id) => state.jobs[id]).find((j) => j.status === "running" || j.status === "queued");
  if (!j) return undefined;
  return `${jobLabel(j)}…`;
}
