import { createContext, useContext, useEffect, useRef } from "react";
import type { ChatContext } from "../../shared/protocol";

/** Lines in a file, as a citation names them. */
export type LinesTarget = { path: string; start: number; end: number };

/** What a panel can show when a citation is clicked. Registered while the panel is mounted. */
export type LineShower = {
  /** Whether it can show this file right now (e.g. the Guide's current chapter has it). */
  canShow: (path: string) => boolean;
  show: (t: LinesTarget) => void;
};

/**
 * The few explicit connections between panels. Panels never share scroll or state; they only ask the
 * workspace to show lines or to ask a question with context.
 */
export type WorkspaceActions = {
  showLines: (t: LinesTarget) => void;
  ask: (context: ChatContext) => void;
  register: (module: string, s: LineShower) => () => void;
};

const noop: WorkspaceActions = { showLines: () => {}, ask: () => {}, register: () => () => {} };
export const ActionsContext = createContext<WorkspaceActions>(noop);

export function useActions(): WorkspaceActions {
  return useContext(ActionsContext);
}

/** Let the workspace send citations for `module` to this panel. */
export function useLineShower(module: string, shower: LineShower) {
  const { register } = useActions();
  const ref = useRef(shower);
  ref.current = shower;
  useEffect(
    () => register(module, { canShow: (p) => ref.current.canShow(p), show: (t) => ref.current.show(t) }),
    [module, register],
  );
}
