import { latestDone, moduleBusy, type ModuleInfo } from "../../shared/modules";
import type { JobState, SessionState } from "../../shared/state";

export type PanelState = {
  /** A job of this module (its own, or a follow-up it started) is queued or running. */
  busy: boolean;
  /** What the busy job is doing. */
  activity?: string;
  /** Which job of the run is going, e.g. "Reviewing the guide · job 2 of up to 4". */
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

/** What a job does, as the reader sees it: "Writing the guide", "Reviewing the guide". */
export function jobLabel(j: JobState): string {
  return j.label ?? `Writing the ${j.kind}`;
}

function stageLabel(m: ModuleInfo, state: SessionState, j: JobState): string {
  const { job, of } = runProgress(m, state);
  return of > 1 ? `${jobLabel(j)} · job ${job} of ${of === job ? of : `up to ${of}`}` : jobLabel(j);
}

/**
 * How far along a module's current run is: the jobs it has finished (its own, then its follow-ups) out of the most
 * it can take, plus a share of the running one, from the work it has reported. It only moves forward; a run that
 * needs fewer jobs than the most is simply done early.
 */
export function runProgress(m: ModuleInfo, state: SessionState): { job: number; of: number; fraction: number } {
  const jobs = state.jobOrder.map((id) => state.jobs[id]).filter((j) => j.module === m.name);
  // A run starts with a job that doesn't follow up another of the module's jobs.
  const start = jobs.findLastIndex((j) => !jobs.some((p) => p.id === j.inputs[0]));
  const run = jobs.slice(Math.max(start, 0));
  const finished = run.filter((j) => j.status === "finished").length;
  const current = run.find((j) => j.status === "running");
  const share = current ? 1 - Math.exp(-current.steps / 12) : 0;
  const of = Math.max(m.maxJobs ?? 1, finished + 1);
  return { job: finished + 1, of, fraction: (finished + 0.9 * share) / of };
}

/** What the session is doing, for the status bar: "Writing the guide…", "Reviewing the guide…". */
export function sessionActivity(state: SessionState): string | undefined {
  const j = state.jobOrder.map((id) => state.jobs[id]).find((j) => j.status === "running" || j.status === "queued");
  if (!j) return undefined;
  return `${jobLabel(j)}…`;
}
