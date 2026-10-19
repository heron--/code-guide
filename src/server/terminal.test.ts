import { expect, test } from "vitest";
import type { ModuleInfo } from "../shared/modules";
import { PROTOCOL_VERSION, type SessionEvent } from "../shared/protocol";
import { emptyState, reduce, type SessionState } from "../shared/state";
import type { Session } from "./session";
import { clipLine, logLine, printable, reportStatus, statusLines, widthOf, type StatusReport } from "./terminal";

const guide: ModuleInfo = { name: "guide", label: "Guide", icon: [], needsJob: true, kind: "guide", maxJobs: 4 };
const quiz: ModuleInfo = { name: "quiz", label: "Quiz", icon: [], needsJob: true, kind: "quiz" };
const chat: ModuleInfo = { name: "chat", label: "Chat", icon: [], needsJob: false };

const ev = (seq: number, type: string, payload: Record<string, unknown>) =>
  ({ v: PROTOCOL_VERSION, seq, at: "", session: "s", type, payload }) as SessionEvent;
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

test("a session process reports what happened before, then its log and live block as they change", async () => {
  let listener: ((e: SessionEvent) => void) | undefined;
  const before = [ev(1, "session.subject", { subject: { type: "path", path: "src" }, label: "src" })];
  const fake = {
    state: running,
    subscribe: (fn: (e: SessionEvent) => void) => ((listener = fn), () => (listener = undefined)),
    eventsAfter: () => before,
  } as unknown as Session;
  const reports: StatusReport[] = [];
  const stop = reportStatus(
    fake,
    [guide, quiz],
    { harness: "h", model: "m", status: () => ({ state: "idle" }), onStatus: () => () => {} },
    (r) => reports.push(r),
  );
  expect(reports[0]).toEqual({ log: "Subject: src" });
  expect(reports[1]).toEqual({
    live: [
      "Agent  h · m · context empty · idle",
      "Guide  [░░░░░░░░░░░░░░░░] Writing the guide · job 1 of up to 4 · Reading a.ts",
      "Quiz   failed: no luck",
    ],
  });
  listener!(ev(6, "job.failed", { job: "quiz-1", error: "no luck", problems: [] }));
  expect(reports[2]).toEqual({ log: "✗ Writing the quiz (quiz-1) failed: no luck" });
  // Live updates are batched.
  await new Promise((r) => setTimeout(r, 150));
  expect(reports).toHaveLength(4);
  stop();
  expect(listener).toBeUndefined();
});

test("text from the repository can't send the terminal escape sequences", () => {
  expect(printable("a\x1b[2Jb\x1b]0;title\x07c\rd")).toBe("a b c d");
});

test("lines are clipped by display width, counting wide characters as two columns", () => {
  // "Quiz  failed: " is 14 columns, each wide character 2, "…" 1: 12 wide characters make 39, within 40.
  expect(clipLine("Quiz  failed: " + "错误".repeat(20), 39)).toBe("Quiz  failed: " + "错误".repeat(6) + "…");
  expect(clipLine("Quiz  failed: " + "🚀".repeat(20), 39)).toBe("Quiz  failed: " + "🚀".repeat(12) + "…");
  // Progress bars count as one column each.
  expect(widthOf("[████░░░░]")).toBe(10);
  expect(clipLine("fits", 4)).toBe("fits");
  expect(clipLine("a\x1b[2Jb", 10)).toBe("a b");
});
