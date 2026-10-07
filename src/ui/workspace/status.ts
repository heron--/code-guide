import { latestFinished, moduleBusy, type ModuleInfo } from "../../shared/modules";
import type { JobState, SessionState } from "../../shared/state";

export type PanelState = {
  /** A job of this module (its own, or a follow-up like a review) is queued or running. */
  busy: boolean;
  /** What the busy job is doing. */
  activity?: string;
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
    job: m.kind ? latestFinished(state, m.kind) : undefined,
    failed: !busy && last?.status === "failed" ? last : undefined,
  };
}

/** What the session is doing, for the status bar: "Writing guide…", "Reviewing guide…". */
export function sessionActivity(state: SessionState): string | undefined {
  const j = state.jobOrder.map((id) => state.jobs[id]).find((j) => j.status === "running" || j.status === "queued");
  if (!j) return undefined;
  if (j.kind === "review") return "Reviewing guide…";
  if (j.kind === "guide" && j.inputs.length) return "Revising guide…";
  return `Writing ${j.kind}…`;
}
