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
  /** The left slot's share of the width, 0–1. */
  split: number;
};

export const emptyLayout: Layout = { dock: [], recent: "left", split: 0.5 };

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
  let next: Layout = { ...l, dock: l.dock.filter((p) => p !== panel), maximized: undefined };
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
  return {
    ...l,
    [slot]: undefined,
    dock: [...l.dock, panel],
    maximized: l.maximized === slot ? undefined : l.maximized,
  };
}

/** Discard a panel from the dock. */
export function discard(l: Layout, panel: string): Layout {
  return { ...l, dock: l.dock.filter((p) => p !== panel) };
}

export function swap(l: Layout): Layout {
  return { ...l, left: l.right, right: l.left, recent: other(l.recent) };
}

export function toggleMaximized(l: Layout, slot: Slot): Layout {
  return { ...l, maximized: l.maximized === slot ? undefined : slot, recent: slot };
}

export function setSplit(l: Layout, split: number): Layout {
  return { ...l, split: Math.min(0.8, Math.max(0.2, split)) };
}
