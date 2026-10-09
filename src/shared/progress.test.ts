import { expect, test } from "vitest";
import type { ModuleInfo } from "./modules";
import { PROTOCOL_VERSION, type SessionEvent } from "./protocol";
import { emptyState, reduce, type SessionState } from "./state";
import { panelState, runProgress } from "./progress";

const guide: ModuleInfo = { name: "guide", label: "Guide", icon: [], needsJob: true, kind: "guide", maxJobs: 4 };

/** A session built from events, numbered in order. */
function session(...events: [string, Record<string, unknown>][]): SessionState {
  return events.reduce(
    (s, [type, payload], i) =>
      reduce(s, { v: PROTOCOL_VERSION, seq: i + 1, at: "", session: "s", type, payload } as SessionEvent),
    emptyState("s"),
  );
}
const queued = (job: string, kind: string, inputs: string[] = []) =>
  ["job.queued", { job, kind, module: "guide", inputs }] as [string, Record<string, unknown>];
const started = (job: string) => ["job.started", { job }] as [string, Record<string, unknown>];
const finished = (job: string) =>
  ["job.finished", { job, result: `results/${job}.json`, warnings: [] }] as [string, Record<string, unknown>];

test("the run's progress counts finished jobs, so starting the review doesn't go back to zero", () => {
  const writing = runProgress(guide, session(queued("guide-1", "guide"), started("guide-1")));
  const reviewing = runProgress(
    guide,
    session(
      queued("guide-1", "guide"),
      started("guide-1"),
      finished("guide-1"),
      queued("review-1", "review", ["guide-1"]),
      started("review-1"),
    ),
  );
  expect(writing).toMatchObject({ job: 1, of: 4 });
  expect(reviewing).toMatchObject({ job: 2, of: 4, fraction: 0.25 });
  expect(reviewing.fraction).toBeGreaterThan(writing.fraction);
});

test("a revision continues the same run", () => {
  const s = session(
    queued("guide-1", "guide"),
    finished("guide-1"),
    queued("review-1", "review", ["guide-1"]),
    finished("review-1"),
    [
      "job.queued",
      { job: "guide-2", kind: "guide", label: "Revising the guide", module: "guide", inputs: ["guide-1", "review-1"] },
    ],
    started("guide-2"),
  );
  expect(runProgress(guide, s)).toMatchObject({ job: 3, of: 4 });
  expect(panelState(guide, s).stage).toBe("Revising the guide · job 3 of up to 4");
  // Nothing is shown until the revision has been reviewed.
  expect(panelState(guide, s).job).toBeUndefined();
});

test("a guide whose review failed isn't shown, and the failure is", () => {
  const s = session(queued("guide-1", "guide"), finished("guide-1"), queued("review-1", "review", ["guide-1"]), [
    "job.failed",
    { job: "review-1", error: "the reviewer crashed", problems: [] },
  ]);
  expect(panelState(guide, s)).toMatchObject({ job: undefined, busy: false, failed: { id: "review-1" } });
});

const trace: ModuleInfo = {
  name: "trace",
  label: "Trace",
  icon: [],
  needsJob: true,
  kind: "scenarios",
  pickKind: "trace",
};
const picked = (job: string, from: string, pick: number) =>
  ["job.queued", { job, kind: "trace", module: "trace", inputs: [from], pick }] as [string, Record<string, unknown>];
const failed = (job: string) => ["job.failed", { job, error: "no", problems: [] }] as [string, Record<string, unknown>];
const scenarios = [
  ["job.queued", { job: "scenarios-1", kind: "scenarios", module: "trace", inputs: [] }],
  started("scenarios-1"),
  finished("scenarios-1"),
] as [string, Record<string, unknown>][];

test("a job the reader picked isn't a follow-up: its scenarios stay shown while it runs, or after it fails", () => {
  const writing = session(...scenarios, picked("trace-1", "scenarios-1", 0), started("trace-1"));
  expect(panelState(trace, writing)).toMatchObject({ busy: true, job: "scenarios-1", result: "scenarios-1" });
  expect(runProgress(trace, writing)).toMatchObject({ job: 1, of: 1 });
  const broke = session(...scenarios, picked("trace-1", "scenarios-1", 0), started("trace-1"), failed("trace-1"));
  expect(panelState(trace, broke)).toMatchObject({ job: "scenarios-1" });
  // A finished trace is the module's newest result, which marks its dock square.
  const traced = session(...scenarios, picked("trace-1", "scenarios-1", 0), started("trace-1"), finished("trace-1"));
  expect(panelState(trace, traced)).toMatchObject({ job: "scenarios-1", result: "trace-1" });
});
