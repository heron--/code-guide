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
  for (const kind of m.results ?? []) if (!latestFinished(state, kind)) return `${m.label} needs a finished ${kind}`;
  return undefined;
}

/** The newest finished job of a kind. */
export function latestFinished(state: SessionState, kind: string): string | undefined {
  return state.jobOrder.findLast((id) => state.jobs[id].kind === kind && state.jobs[id].status === "finished");
}

/** Whether any of a module's jobs (its own, or follow-ups like a review) is still queued or running. */
export function moduleBusy(state: SessionState, module: string): boolean {
  return state.jobOrder.some(
    (id) => state.jobs[id].module === module && ["queued", "running"].includes(state.jobs[id].status),
  );
}
