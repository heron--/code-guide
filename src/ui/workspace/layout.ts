/**
 * Where each panel is: in one of two slots, or in the dock. One panel per module, named by the module. Pure, so
 * the rules are tested without a browser.
 */
export type Slot = "left" | "right";

export type Layout = {
  left?: string;
  right?: string;
  /** Panels not in a slot, in dock order. */
  dock: string[];
  /** The slot last used: where a panel goes when both are full. */
  recent: Slot;
  maximized?: Slot;
  /** The panel maximizing sent to the dock from the other slot, put back when the maximized one is restored. */
  minimized?: string;
  /** The left slot's share of the width, 0–1. */
  split: number;
  /** Jobs already given a dock square, so a discarded panel doesn't come back until a new job starts. */
  known: string[];
  /** The result each panel last showed in a slot; a newer one marks its dock square "ready". */
  seen: Record<string, string>;
};

export const emptyLayout: Layout = { dock: [], recent: "left", split: 0.5, known: [], seen: {} };

/** A new session's layout: these panels in the slots, left to right (a third and later go to the dock). */
export function initialLayout(panels: string[]): Layout {
  return panels.reduce((l, p) => (has(l, p) ? l : !l.left || !l.right ? open(l, p) : addToDock(l, p)), emptyLayout);
}

/** A job started: its module's panel waits in the dock unless it's already open (once per job). */
export function jobStarted(l: Layout, job: string, panel: string): Layout {
  if (l.known.includes(job)) return l;
  return { ...addToDock(l, panel), known: [...l.known, job] };
}

/** Note the result a panel in a slot is showing. */
export function markSeen(l: Layout, panel: string, result: string): Layout {
  return l.seen[panel] === result ? l : { ...l, seen: { ...l.seen, [panel]: result } };
}

const other = (s: Slot): Slot => (s === "left" ? "right" : "left");

export function slotOf(l: Layout, panel: string): Slot | undefined {
  return l.left === panel ? "left" : l.right === panel ? "right" : undefined;
}

export function has(l: Layout, panel: string): boolean {
  return !!slotOf(l, panel) || l.dock.includes(panel);
}

/** Put a panel in the dock if it isn't anywhere yet (e.g. a module whose job just started). */
export function addToDock(l: Layout, panel: string): Layout {
  return has(l, panel) ? l : { ...l, dock: [...l.dock, panel] };
}

/**
 * Open a panel: into an empty slot (left first), else the more recently used slot, whose panel goes to the
 * dock. A panel already in a slot just becomes the recent one.
 */
export function open(l: Layout, panel: string, into?: Slot): Layout {
  const at = slotOf(l, panel);
  if (at && !into) return { ...l, recent: at };
  let next: Layout = { ...l, dock: l.dock.filter((p) => p !== panel), maximized: undefined, minimized: undefined };
  if (at) next = { ...next, [at]: undefined };
  const slot = into ?? (!next.left ? "left" : !next.right ? "right" : next.recent);
  const displaced = next[slot];
  next = { ...next, [slot]: panel, recent: slot };
  if (displaced && displaced !== panel) next.dock = [...next.dock, displaced];
  return next;
}

/** × on a panel: back to the dock. Panels are never destroyed from their title bar. */
export function toDock(l: Layout, slot: Slot): Layout {
  const panel = l[slot];
  if (!panel) return l;
  const next = { ...l, [slot]: undefined, dock: [...l.dock, panel] };
  // Docking the maximized panel brings back the one maximizing hid.
  return l.maximized === slot ? unmaximize(next) : next;
}

/** Discard a panel from the dock. */
export function discard(l: Layout, panel: string): Layout {
  return { ...l, dock: l.dock.filter((p) => p !== panel) };
}

export function swap(l: Layout): Layout {
  return { ...l, left: l.right, right: l.left, recent: other(l.recent) };
}

/**
 * Maximizing a panel sends the other slot's panel to the dock; restoring puts it back, unless it has since been
 * opened somewhere else or discarded.
 */
export function toggleMaximized(l: Layout, slot: Slot): Layout {
  if (l.maximized === slot) return { ...unmaximize(l), recent: slot };
  const restored = unmaximize(l);
  const neighbor = restored[other(slot)];
  return {
    ...restored,
    [other(slot)]: undefined,
    dock: neighbor ? [...restored.dock, neighbor] : restored.dock,
    maximized: slot,
    minimized: neighbor,
    recent: slot,
  };
}

function unmaximize(l: Layout): Layout {
  const next = { ...l, maximized: undefined, minimized: undefined };
  const p = l.minimized;
  if (!p || !l.dock.includes(p)) return next;
  const slot = l.maximized ? other(l.maximized) : !l.left ? "left" : "right";
  if (next[slot]) return next;
  return { ...next, [slot]: p, dock: next.dock.filter((d) => d !== p) };
}

export function setSplit(l: Layout, split: number): Layout {
  return { ...l, split: Math.min(0.8, Math.max(0.2, split)) };
}

/**
 * Where a square dragged from the dock would land, given which half of the workspace the pointer is over:
 * - both slots full: it replaces the panel there, which goes to the dock
 * - one slot full: it opens on the pointer's side, moving the other panel aside
 * - none: it takes the whole workspace (the left slot)
 */
export function dropTarget(l: Layout, half: Slot): Slot {
  if (!l.left && !l.right) return "left";
  return half;
}

export function dropFromDock(l: Layout, panel: string, target: Slot): Layout {
  const occupant = l[target];
  const free = other(target);
  if (occupant && !l[free]) return { ...open({ ...l, [target]: undefined, [free]: occupant }, panel, target) };
  return open(l, panel, target);
}
