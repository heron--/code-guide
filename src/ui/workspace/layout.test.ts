import { expect, test } from "vitest";
import {
  addToDock,
  discard,
  dropFromDock,
  dropTarget,
  emptyLayout,
  initialLayout,
  jobStarted,
  markSeen,
  open,
  setSplit,
  swap,
  toDock,
  toggleMaximized,
} from "./layout";

test("a started module waits in the dock", () => {
  const l = addToDock(addToDock(emptyLayout, "guide"), "guide");
  expect([l.left, l.right, l.dock]).toEqual([undefined, undefined, ["guide"]]);
});

test("opening fills an empty slot, else the more recently used one, sending its panel to the dock", () => {
  let l = addToDock(emptyLayout, "guide");
  l = open(l, "guide");
  expect(l).toMatchObject({ left: "guide", dock: [], recent: "left" });
  l = open(l, "chat");
  expect(l).toMatchObject({ left: "guide", right: "chat", recent: "right" });
  l = open(l, "guide"); // already open: just becomes recent
  expect(l).toMatchObject({ left: "guide", right: "chat", recent: "left" });
  l = open(l, "diff");
  expect(l).toMatchObject({ left: "diff", right: "chat", dock: ["guide"], recent: "left" });
});

test("× sends a panel to the dock, and clicking it there restores it", () => {
  let l = open(open(emptyLayout, "guide"), "chat");
  l = toDock(l, "left");
  expect(l).toMatchObject({ left: undefined, right: "chat", dock: ["guide"] });
  l = open(l, "guide");
  expect(l).toMatchObject({ left: "guide", right: "chat", dock: [] });
});

test("a panel can be opened into a chosen slot", () => {
  let l = open(open(emptyLayout, "guide"), "chat");
  l = open(l, "quiz", "left");
  expect(l).toMatchObject({ left: "quiz", right: "chat", dock: ["guide"] });
  l = open(l, "chat", "left"); // moving within the slots
  expect(l).toMatchObject({ left: "chat", right: undefined, dock: ["guide", "quiz"] });
});

test("discard, swap, maximize and the divider", () => {
  let l = open(open(emptyLayout, "guide"), "chat");
  expect(swap(l)).toMatchObject({ left: "chat", right: "guide" });
  l = toggleMaximized(l, "right");
  expect(l.maximized).toBe("right");
  expect(toDock(l, "right").maximized).toBeUndefined();
  expect(toggleMaximized(l, "right").maximized).toBeUndefined();
  expect(discard(toDock(l, "left"), "guide").dock).toEqual([]);
  expect(setSplit(l, 0.95).split).toBe(0.8);
});

test("maximizing docks the neighbor, and restoring brings it back", () => {
  const l = open(open(emptyLayout, "guide"), "chat");
  const max = toggleMaximized(l, "right");
  expect(max).toMatchObject({ left: undefined, right: "chat", maximized: "right", dock: ["guide"] });
  expect(toggleMaximized(max, "right")).toMatchObject({ left: "guide", right: "chat", maximized: undefined, dock: [] });
  // Docking the maximized panel restores the neighbor too.
  expect(toDock(max, "right")).toMatchObject({ left: "guide", right: undefined, dock: ["chat"] });
  // A neighbor opened or discarded meanwhile stays where it is.
  expect(toggleMaximized(discard(max, "guide"), "right")).toMatchObject({ left: undefined, dock: [] });
  const reopened = open(max, "guide");
  expect(reopened).toMatchObject({ left: "guide", right: "chat", maximized: undefined, minimized: undefined });
  // With nothing beside it, maximizing only maximizes.
  expect(toggleMaximized(open(emptyLayout, "guide"), "left")).toMatchObject({ left: "guide", dock: [] });
});

test("each new job puts its module in the dock once, even after the panel was discarded", () => {
  let l = jobStarted(emptyLayout, "guide-1", "guide");
  expect(l.dock).toEqual(["guide"]);
  l = discard(l, "guide");
  expect(jobStarted(l, "guide-1", "guide").dock).toEqual([]);
  expect(jobStarted(l, "guide-2", "guide").dock).toEqual(["guide"]);
  // A panel already in a slot stays there.
  l = jobStarted(open(emptyLayout, "guide"), "guide-3", "guide");
  expect([l.left, l.dock]).toEqual(["guide", []]);
});

test("results a panel has shown are remembered", () => {
  const l = markSeen(emptyLayout, "guide", "guide-1");
  expect(l.seen).toEqual({ guide: "guide-1" });
  expect(markSeen(l, "guide", "guide-1")).toBe(l);
});

test("dropping from the dock", () => {
  const both = open(open(emptyLayout, "guide"), "chat");
  // Both full: replaces the panel under the pointer; it goes to the dock.
  expect(dropFromDock(both, "quiz", dropTarget(both, "right"))).toMatchObject({
    left: "guide",
    right: "quiz",
    dock: ["chat"],
  });
  // One full: opens on the pointer's side, moving the other panel aside.
  const one = open(emptyLayout, "guide");
  expect(dropFromDock(one, "quiz", dropTarget(one, "left"))).toMatchObject({ left: "quiz", right: "guide", dock: [] });
  expect(dropFromDock(one, "quiz", dropTarget(one, "right"))).toMatchObject({ left: "guide", right: "quiz", dock: [] });
  // None: the whole workspace.
  expect(dropTarget(emptyLayout, "right")).toBe("left");
  expect(dropFromDock(addToDock(emptyLayout, "quiz"), "quiz", "left")).toMatchObject({ left: "quiz", dock: [] });
});

test("a new session opens its default panels left to right", () => {
  expect(initialLayout(["guide", "chat"])).toMatchObject({ left: "guide", right: "chat", dock: [], recent: "right" });
  expect(initialLayout(["guide", "chat", "diff"])).toMatchObject({ left: "guide", right: "chat", dock: ["diff"] });
  expect(initialLayout([])).toEqual(emptyLayout);
  // The guide's first job finds its panel already open, and leaves it there.
  expect(jobStarted(initialLayout(["guide"]), "guide-1", "guide")).toMatchObject({ left: "guide", dock: [] });
});
