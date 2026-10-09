import { expect, test } from "vitest";
import { callFrames, nestingProblems, packageOf, stepTargets, type Step } from "./trace";

/** A step in f at depth d; `call` marks entering it. */
const s = (fn: string, depth: number, call?: string, path = `internal/${fn.toLowerCase()}/a.go`): Step => ({
  path,
  line: 1,
  function: fn,
  depth,
  text: "x",
  ...(call && { call }),
});

// handle → Latest → Do → (shouldRetry, delay) → Do → back out to handle.
const steps = [
  s("handle", 0, "Handles it"),
  s("Latest", 1, "Asks for the latest"),
  s("Do", 2, "Sends it"),
  s("shouldRetry", 3, "Decides"),
  s("shouldRetry", 3),
  s("delay", 3, "Waits"),
  s("Do", 2),
  s("Latest", 1),
  s("handle", 0),
];

test("calls nest and end where their steps do", () => {
  const { frames, at } = callFrames(steps);
  expect(frames.map((f) => [f.function, f.depth, f.start, f.end])).toEqual([
    ["handle", 0, 0, 8],
    ["Latest", 1, 1, 7],
    ["Do", 2, 2, 6],
    ["shouldRetry", 3, 3, 4],
    ["delay", 3, 5, 5],
  ]);
  expect(at).toEqual([0, 1, 2, 3, 3, 4, 2, 1, 0]);
  expect(frames[1].summary).toBe("Asks for the latest");
});

test("stepping over skips calls, out leaves the current one, into and back move one step", () => {
  const { frames, at } = callFrames(steps);
  const t = (i: number) => stepTargets(steps, frames, at, i);
  expect(t(2)).toEqual({ over: 6, into: 3, out: 7, back: 1 });
  // From inside shouldRetry, over stays in it; out goes back to Do, past the sibling call to delay.
  expect(t(3)).toMatchObject({ over: 4, out: 6 });
  expect(t(4)).toMatchObject({ over: 6 });
  expect(t(0)).toMatchObject({ over: 8, out: undefined, back: undefined });
  expect(t(8)).toEqual({ over: undefined, into: undefined, out: undefined, back: 7 });
});

test("nesting must be consistent: no call entered too deep, no return to one never entered", () => {
  expect(nestingProblems(steps)).toEqual([]);
  expect(nestingProblems([s("handle", 1)]).map((p) => p.message)).toEqual([
    "the first step is at depth 0",
    "the first step enters the outermost function: give it `call`",
  ]);
  expect(nestingProblems([steps[0], s("Do", 2, "Sends it")])[0].message).toMatch(/deepest open call is at depth 0/);
  expect(nestingProblems([steps[0], s("Do", 1)])[0].message).toMatch(/no call was entered there/);
  expect(nestingProblems([steps[0], steps[1], s("Other", 0)])[0].message).toMatch(/open at depth 0 is handle/);
  // Only steps from `from` on are reported.
  expect(nestingProblems([s("handle", 1), s("handle", 0)], 1)).toEqual([]);
  expect(nestingProblems([steps[0], steps[0]])[0].message).toBe(
    "enters a call at depth 0; only the first step does that",
  );
});

test("a step's package is its directory, or the outside package it calls", () => {
  expect(packageOf({ path: "internal/api/quotes.go" })).toBe("internal/api");
  expect(packageOf({ path: "main.go" })).toBe(".");
  expect(packageOf({ path: "internal/httpclient/client.go", package: "net/http" })).toBe("net/http");
});
