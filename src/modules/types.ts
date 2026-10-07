import type { ModuleInfo } from "../shared/modules.js";
import type { SessionState } from "../shared/state.js";
import type { JobKind } from "../server/jobs.js";

/**
 * A module: one way of working with the subject. Each lives in its own folder under src/modules/:
 *
 * - `module.ts` exports a `Module` (this type). The server reads it; nothing in it may import the UI.
 * - `panel.tsx` default-exports the panel that renders it in the browser (see src/ui/lib/panels.ts).
 *
 * Registering it is one line in src/modules/index.ts. Nothing in the workspace or job runner names a module.
 */
export type Module = Omit<ModuleInfo, "needsJob"> & {
  /** Modules that need a job supply its kind. Its inputs are the latest finished result of each of `results`. */
  job?: JobKind;
  /** Start its job as soon as the session has a subject. */
  startsWithSession?: boolean;
  /**
   * Called when one of this module's jobs finishes. Returns a follow-up job to run in the same module, e.g. a
   * review after a guide. Its inputs are finished jobs.
   */
  next?: (done: { job: string; kind: string; result: unknown }, state: SessionState) => FollowUp | undefined;
};

export type FollowUp = { job: JobKind; inputs: string[] };

export function defineModule(m: Module): Module {
  return m;
}

export function moduleInfo({ job, startsWithSession: _, next: __, ...m }: Module): ModuleInfo {
  return { ...m, needsJob: !!job, ...(job && { kind: job.kind }) };
}
