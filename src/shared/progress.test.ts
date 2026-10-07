import { expect, test } from "vitest";
import type { ModuleInfo } from "./modules";
import type { SessionEvent } from "./protocol";
import { emptyState, reduce, type SessionState } from "./state";
import { panelState, runProgress } from "./progress";

const guide: ModuleInfo = { name: "guide", label: "Guide", icon: [], needsJob: true, kind: "guide", maxJobs: 4 };

/** A session built from events, numbered in order. */
function session(...events: [string, Record<string, unknown>][]): SessionState {
  return events.reduce(
    (s, [type, payload], i) => reduce(s, { v: 1, seq: i + 1, at: "", session: "s", type, payload } as SessionEvent),
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
