import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ModuleInfo } from "../../shared/modules";
import type { SessionState } from "../../shared/state";
import type { SessionChannel } from "./session";

/** What every module's panel is given. Panels talk to the server only through `channel`. */
export type PanelProps = {
  module: ModuleInfo;
  state: SessionState;
  channel: SessionChannel;
  /** For a module with a job: the job whose result this panel shows. */
  job?: string;
};

// Each module's panel is src/modules/<name>/panel.tsx, found by convention so registering a module stays one line.
const found = import.meta.glob<{ default: ComponentType<PanelProps> }>("../../modules/*/panel.tsx");
const cache = new Map<string, LazyExoticComponent<ComponentType<PanelProps>>>();

/** The panel component for a module, loaded on first use; undefined if the module has none. */
export function panelFor(name: string): LazyExoticComponent<ComponentType<PanelProps>> | undefined {
  const load = found[`../../modules/${name}/panel.tsx`];
  if (!load) return undefined;
  if (!cache.has(name)) cache.set(name, lazy(load));
  return cache.get(name);
}
