import type { ModuleInfo } from "../shared/modules.js";
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
};

export function defineModule(m: Module): Module {
  return m;
}

export function moduleInfo({ job, ...m }: Module): ModuleInfo {
  return { ...m, needsJob: !!job };
}
