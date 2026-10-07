import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Chat } from "./chat";
import { FakeHarness } from "./harness/fake";
import type { Harness, HarnessSessionOptions } from "./harness/types";
import { Session } from "./session";

/** The fake harness, recording what the chat tells it. */
class Recording implements Harness {
  name = "recording";
  model = "m";
  starts: string[] = [];
  sent: string[] = [];
  fake = new FakeHarness();
  fail?: string;
  opts?: HarnessSessionOptions;
  async check() {
    return { ok: true as const };
  }
  start(opts: HarnessSessionOptions) {
    this.starts.push(opts.instructions);
    this.opts = opts;
    const s = this.fake.start(opts);
    return {
      ...s,
      send: (text: string) => {
        this.sent.push(text);
        if (this.fail) return opts.onEvent({ type: "error", message: this.fail, fatal: true });
        s.send(text);
      },
    };
  }
}

let repo: string;
let session: Session;
let harness: Recording;
let chat: Chat;

async function until(cond: () => boolean) {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
}
const replies = () => session.state.chat.filter((m) => m.from === "agent");

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "cg-chat-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.ts"), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
  session = await Session.create(repo);
  session.append("session.subject", { subject: { type: "path", path: "src" }, label: "src" });
  harness = new Recording();
  chat = new Chat(session, harness);
});
afterEach(async () => {
  await chat.stop();
  rmSync(repo, { recursive: true, force: true });
});

async function finish(job: string, kind: string, result: unknown) {
  session.append("job.queued", { job, kind, module: kind, inputs: [] });
  session.append("job.finished", { job, result: await session.writeResult(job, result), warnings: [] });
}

test("starts on the first message, and streams the reply into the log", async () => {
  expect(harness.starts).toEqual([]);
  await chat.send("Reply with exactly: it retries twice", []);
  expect(harness.starts).toHaveLength(1);
  expect(harness.starts[0]).toContain("src, in the working tree");
  await until(() => replies()[0]?.status === "done");
  expect(session.state.chat).toEqual([
    expect.objectContaining({ id: "m-1", from: "reader", text: "Reply with exactly: it retries twice" }),
    expect.objectContaining({ id: "m-2", from: "agent", replyTo: "m-1", text: "it retries twice", status: "done" }),
  ]);
  const types = session.eventsAfter(0).map((e) => e.type);
  expect(types.filter((t) => t === "chat.delta").length).toBeGreaterThan(1);
});

test("answers messages in order, in one harness session", async () => {
  await Promise.all([chat.send("Reply with exactly: one", []), chat.send("Reply with exactly: two", [])]);
  await until(() => replies().length === 2 && replies().every((r) => r.status === "done"));
  expect(replies().map((r) => [r.replyTo, r.text])).toEqual([
    ["m-1", "one"],
    ["m-2", "two"],
  ]);
  expect(harness.starts).toHaveLength(1);
});

test("knows finished guides and quizzes, each told once, never transcripts", async () => {
  await finish("guide-1", "guide", { title: "Retries", chapters: [] });
  await finish("review-1", "review", { verdict: "accept", findings: [] });
  await chat.send("Reply with exactly: ok", []);
  expect(harness.sent[0]).toContain("A guide finished (guide-1)");
  expect(harness.sent[0]).toContain('"title":"Retries"');
  expect(harness.sent[0]).not.toContain("review-1");
  await finish("quiz-1", "quiz", { questions: [] });
  await chat.send("Reply with exactly: ok", []);
  expect(harness.sent[1]).toContain("A quiz finished (quiz-1)");
  expect(harness.sent[1]).not.toContain("guide-1");
});

test("sends the context with the message, and records it on the message", async () => {
  await finish("guide-1", "guide", {
    chapters: [{ title: "Retry safely", body: "Only GET retries.", excerpts: [] }],
  });
  const context = [
    { kind: "code" as const, path: "a.ts", start: 3, end: 4 },
    { kind: "chapter" as const, job: "guide-1", chapter: 0 },
    { kind: "prose" as const, job: "guide-1", chapter: 0, text: "Only GET retries." },
  ];
  await chat.send("Reply with exactly: why", context);
  expect(harness.sent[0]).toContain("The reader selected a.ts#L3-L4:\n```\n3  line 3\n4  line 4\n```");
  expect(harness.sent[0]).toContain('The reader is on chapter 1 of guide-1, "Retry safely":\nOnly GET retries.');
  expect(harness.sent[0]).toContain("The reader selected this passage from chapter 1 of guide-1");
  expect(session.state.chat[0].context).toEqual(context);
});

test("a harness that dies fails the waiting replies, and the next message starts a new one", async () => {
  await finish("guide-1", "guide", { title: "Retries", chapters: [] });
  harness.fail = "the harness exited";
  await chat.send("Reply with exactly: lost", []);
  await until(() => replies()[0]?.status === "failed");
  expect(replies()[0].error).toBe("the harness exited");
  harness.fail = undefined;
  await chat.send("Reply with exactly: back", []);
  await until(() => replies()[1]?.status === "done");
  expect(harness.starts).toHaveLength(2);
  // The new harness is told about the guide again.
  expect(harness.sent[1]).toContain("A guide finished (guide-1)");
});

test("a harness that dies between messages is replaced by the next one", async () => {
  await finish("guide-1", "guide", { title: "Retries", chapters: [] });
  await chat.send("Reply with exactly: one", []);
  await until(() => replies()[0]?.status === "done");
  harness.opts!.onEvent({ type: "error", message: "the harness exited", fatal: true });
  await chat.send("Reply with exactly: two", []);
  await until(() => replies()[1]?.status === "done");
  expect(harness.starts).toHaveLength(2);
  expect(harness.sent[1]).toContain("A guide finished (guide-1)");
});

test("code context can't reach outside the repository through a symlink", async () => {
  const outside = mkdtempSync(join(tmpdir(), "cg-outside-"));
  writeFileSync(join(outside, "secret.txt"), "secret\n");
  symlinkSync(outside, join(repo, "out"));
  await chat.send("Reply with exactly: x", [{ kind: "code", path: "out/secret.txt", start: 1, end: 1 }]);
  expect(harness.sent[0]).not.toContain("secret\n");
  expect(harness.sent[0]).not.toMatch(/1 {2}secret/);
  rmSync(outside, { recursive: true, force: true });
});

test("a message that can't be prepared fails on its own and doesn't take the next reply", async () => {
  session.append("job.queued", { job: "guide-1", kind: "guide", module: "guide", inputs: [] });
  session.append("job.finished", { job: "guide-1", result: "results/missing.json", warnings: [] });
  await expect(chat.send("Reply with exactly: lost", [])).rejects.toThrow();
  expect(replies()[0]).toMatchObject({ replyTo: "m-1", status: "failed" });
  await chat.send("Reply with exactly: next", []);
  await until(() => replies()[1]?.status === "done");
  expect(replies()[1]).toMatchObject({ replyTo: "m-3", text: "next" });
});

test("a message that fails doesn't count its results as told", async () => {
  await finish("guide-1", "guide", { title: "Retries", chapters: [] });
  // Context that can't be read: a finished job whose result is missing.
  session.append("job.queued", { job: "review-1", kind: "review", module: "guide", inputs: [] });
  session.append("job.finished", { job: "review-1", result: "results/missing.json", warnings: [] });
  await expect(
    chat.send("Reply with exactly: lost", [{ kind: "chapter", job: "review-1", chapter: 0 }]),
  ).rejects.toThrow();
  await chat.send("Reply with exactly: ok", []);
  expect(harness.sent.at(-1)).toContain("A guide finished (guide-1)");
});

test("code context from a change whose head no longer resolves is refused", async () => {
  const other = await Session.create(repo);
  other.append("session.subject", { subject: { type: "change", base: "HEAD", head: "gone" }, label: "gone" });
  const c = new Chat(other, harness);
  await expect(c.send("Reply with exactly: x", [{ kind: "code", path: "a.ts", start: 1, end: 2 }])).rejects.toThrow(
    'unknown ref "gone"',
  );
  await c.stop();
});

test("removed lines are read from the change's base", async () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "base", "--allow-empty");
  git("add", "a.ts");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a");
  writeFileSync(join(repo, "a.ts"), "line 1\nline 2\nline 4\n");
  const other = await Session.create(repo);
  other.append("session.subject", { subject: { type: "change", base: "HEAD" }, label: "working tree" });
  const c = new Chat(other, harness);
  await c.send("Reply with exactly: x", [{ kind: "code", path: "a.ts", start: 3, end: 3, side: "old" }]);
  expect(harness.sent.at(-1)).toContain(
    "a.ts#L3-L3 (removed by the change; numbered as before it, so don't link to these line numbers):\n```\n3  line 3\n```",
  );
  await c.send("Reply with exactly: y", [{ kind: "code", path: "a.ts", start: 3, end: 3 }]);
  expect(harness.sent.at(-1)).toContain("a.ts#L3-L3:\n```\n3  line 4\n```");
  await c.stop();
});
