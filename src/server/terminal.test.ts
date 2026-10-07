import { expect, test } from "vitest";
import type { ModuleInfo } from "../shared/modules";
import type { SessionEvent } from "../shared/protocol";
import { emptyState, reduce, type SessionState } from "../shared/state";
import { logLine, showStatus, statusLines } from "./terminal";

const guide: ModuleInfo = { name: "guide", label: "Guide", icon: [], needsJob: true, kind: "guide", maxJobs: 4 };
const quiz: ModuleInfo = { name: "quiz", label: "Quiz", icon: [], needsJob: true, kind: "quiz" };
const chat: ModuleInfo = { name: "chat", label: "Chat", icon: [], needsJob: false };

const ev = (seq: number, type: string, payload: Record<string, unknown>) =>
  ({ v: 1, seq, at: "", session: "s", type, payload }) as SessionEvent;
function session(...events: [string, Record<string, unknown>][]): SessionState {
  return events.reduce((s, [type, payload], i) => reduce(s, ev(i + 1, type, payload)), emptyState("s"));
}

const running = session(
  ["job.queued", { job: "guide-1", kind: "guide", label: "Writing the guide", module: "guide", inputs: [] }],
  ["job.started", { job: "guide-1" }],
  ["job.progress", { job: "guide-1", activity: "Reading a.ts" }],
  ["job.queued", { job: "quiz-1", kind: "quiz", module: "quiz", inputs: [] }],
  ["job.started", { job: "quiz-1" }],
  ["job.failed", { job: "quiz-1", error: "no luck", problems: [] }],
);

test("shows the agent's harness, model, context and state, then each module's job", () => {
  const agent = {
    harness: "claude-code",
    model: "m",
    status: { state: "tool" as const, activity: "Reading b.ts", context: 12_345, window: 200_000 },
  };
  expect(statusLines(running, [guide, quiz, chat], agent)).toEqual([
    "Agent  claude-code · m · context 12.3k/200k (6%) · in a tool call: Reading b.ts",
    "Guide  [░░░░░░░░░░░░░░░░] Writing the guide · job 1 of up to 4 · Reading a.ts",
    "Quiz   failed: no luck",
  ]);
  expect(statusLines(emptyState("s"), [chat], { ...agent, status: { state: "idle" } })).toEqual([
    "Agent  claude-code · m · context empty · idle",
  ]);
});

test("finished and failed jobs go to the log", () => {
  const done = reduce(running, ev(7, "job.finished", { job: "guide-1", result: "r", warnings: [] }));
  expect(logLine(ev(7, "job.finished", { job: "guide-1", result: "r", warnings: [] }), done)).toBe(
    "✓ Writing the guide (guide-1)",
  );
  expect(logLine(ev(6, "job.failed", { job: "quiz-1", error: "no luck", problems: [] }), running)).toBe(
    "✗ Writing the quiz (quiz-1) failed: no luck",
  );
  expect(logLine(ev(3, "job.progress", { job: "guide-1", activity: "x" }), running)).toBeUndefined();
});

test("off a terminal, only the log is written", () => {
  let listener: ((e: SessionEvent) => void) | undefined;
  const fake = {
    state: running,
    subscribe: (fn: (e: SessionEvent) => void) => ((listener = fn), () => {}),
    eventsAfter: () => [],
  } as unknown as Parameters<typeof showStatus>[0];
  let written = "";
  const stop = showStatus(
    fake,
    [guide],
    { harness: "h", model: "m", status: () => ({ state: "idle" }), onStatus: () => () => {} },
    { write: (s: string) => (written += s), isTTY: false },
  );
  listener!(ev(7, "job.finished", { job: "guide-1", result: "r", warnings: [] }));
  listener!(ev(8, "job.progress", { job: "guide-1", activity: "x" }));
  stop();
  expect(written).toBe("✓ Writing the guide (guide-1)\n");
});

test("what happened before the status started is logged first", () => {
  const before = [
    ev(1, "session.subject", { subject: { type: "path", path: "src" }, label: "src" }),
    ev(7, "job.finished", { job: "guide-1", result: "r", warnings: [] }),
  ];
  const fake = {
    state: before.reduce(reduce, running),
    subscribe: () => () => {},
    eventsAfter: () => before,
  } as unknown as Parameters<typeof showStatus>[0];
  let written = "";
  showStatus(
    fake,
    [guide],
    { harness: "h", model: "m", status: () => ({ state: "idle" }), onStatus: () => () => {} },
    { write: (s: string) => (written += s), isTTY: false },
  )();
  expect(written).toBe("Subject: src\n✓ Writing the guide (guide-1)\n");
});
