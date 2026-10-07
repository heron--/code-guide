import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { emptyState, reduce } from "../shared/state";
import { Session, sessionsDir } from "./session";

let repo: string;
afterEach(() => rmSync(repo, { recursive: true, force: true }));

async function busySession() {
  repo = mkdtempSync(join(tmpdir(), "cg-session-"));
  const s = await Session.create(repo);
  s.append("session.subject", { subject: { type: "change", base: "main" }, label: "working tree vs main" });
  s.append("harness.status", { harness: "fake", model: "m", state: "ready" });
  s.append("job.queued", { job: "guide-1", kind: "guide", module: "guide", inputs: [] });
  s.append("job.started", { job: "guide-1" });
  s.append("job.progress", { job: "guide-1", activity: "Reading a.ts" });
  s.append("job.submitted", {
    job: "guide-1",
    attempt: 1,
    accepted: false,
    problems: [{ level: "error", where: "x", message: "y" }],
  });
  s.append("chat.sent", { message: "m-1", text: "Why?", context: [] });
  s.append("chat.started", { message: "m-2", replyTo: "m-1" });
  s.append("chat.delta", { message: "m-2", text: "Because " });
  s.append("chat.delta", { message: "m-2", text: "of a.ts." });
  return s;
}

test("a session lives in .code-guide/sessions/<id>/ and logs every event", async () => {
  const s = await busySession();
  expect(s.dir).toBe(join(sessionsDir(repo), s.id));
  const lines = readFileSync(join(s.dir, "events.jsonl"), "utf8").trim().split("\n");
  expect(lines.map((l) => JSON.parse(l).seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(s.state.jobs["guide-1"]).toMatchObject({ status: "running", activity: "Reading a.ts", attempts: 1 });
  expect(s.state.chat.at(-1)).toMatchObject({ from: "agent", text: "Because of a.ts.", status: "streaming" });
});

test("replaying the log after a restart restores the same state", async () => {
  const s = await busySession();
  const reopened = await Session.open(s.dir);
  expect(reopened.state).toEqual(s.state);
  // The browser builds its state from the same events, so it matches too.
  expect(s.eventsAfter(0).reduce(reduce, emptyState(s.id))).toEqual(s.state);
  // New events continue the sequence.
  expect(reopened.append("chat.finished", { message: "m-2" }).seq).toBe(12);
});

test("eventsAfter returns only what a tab hasn't seen", async () => {
  const s = await busySession();
  expect(s.eventsAfter(9).map((e) => e.seq)).toEqual([10, 11]);
  expect(s.eventsAfter(11)).toEqual([]);
});

test("listeners get each new event once", async () => {
  const s = await busySession();
  const seen: number[] = [];
  const stop = s.subscribe((e) => seen.push(e.seq));
  s.append("chat.finished", { message: "m-2" });
  stop();
  s.append("job.cancelled", { job: "guide-1" });
  expect(seen).toEqual([12]);
});

test("results are files beside the log", async () => {
  const s = await busySession();
  const rel = await s.writeResult("guide-1", { title: "T" });
  s.append("job.finished", { job: "guide-1", result: rel, warnings: [] });
  expect(rel).toBe("results/guide-1.json");
  expect(await (await Session.open(s.dir)).readResult(s.state.jobs["guide-1"].result!)).toEqual({ title: "T" });
  await expect(s.readResult("../../x.json")).rejects.toThrow(/outside the session/);
});
