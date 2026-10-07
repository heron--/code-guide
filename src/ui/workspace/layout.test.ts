import { expect, test } from "vitest";
import { addToDock, discard, emptyLayout, open, setSplit, swap, toDock, toggleMaximized } from "./layout";

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
