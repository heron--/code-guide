import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { latestDone, moduleBusy } from "../../shared/modules";
import type { Harness, HarnessSessionOptions } from "../../server/harness/types";
import { JobRunner } from "../../server/jobs";
import { followUps, requestHandler } from "../../server/requests";
import { Session } from "../../server/session";
import guide from "./module";
import type { Review } from "./review";

let repo: string;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cg-review-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.ts"), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const chapter = (title: string) => ({
  title,
  body: "The file names [its twelfth line](a.ts#L12) plainly.",
  excerpts: [{ path: "a.ts", lines: ["10-14"] }],
});

/** Agents that write a guide, review it with the given verdicts in turn, and revise it when asked. */
class Scripted implements Harness {
  name = "scripted";
  model = "m";
  prompts: Record<string, string[]> = {};
  constructor(private verdicts: Review["verdict"][]) {}
  async check() {
    return { ok: true as const };
  }
  start(opts: HarnessSessionOptions) {
    const tool = opts.tools[0];
    return {
      send: async (text: string) => {
        (this.prompts[tool.name] ??= []).push(text);
        if (tool.name === "submit_review" && this.verdicts[0] === undefined)
          return opts.onEvent({ type: "error", message: "the reviewer crashed", fatal: true });
        const revising = text.startsWith("Revise");
        const input =
          tool.name === "submit_review"
            ? {
                verdict: this.verdicts.shift(),
                findings: [{ chapter: 0, rule: "brief", problem: "Long.", fix: "Cut." }],
              }
            : {
                title: "T",
                question: "Q?",
                answer: "A.",
                chapters: [chapter(revising ? "Read it, revised" : "Read it")],
              };
        await tool.run(input);
        opts.onEvent({ type: "turn.end" });
      },
      cancel: async () => {},
      stop: async () => {},
    };
  }
}

async function run(verdicts: Review["verdict"][]) {
  const session = await Session.create(repo);
  const harness = new Scripted(verdicts);
  const runner = new JobRunner(session, harness);
  followUps(session, runner, [guide]);
  await requestHandler(session, runner, [guide])({
    type: "subject.choose",
    subject: { type: "question", question: "Q?" },
  });
  // The module must never look idle between a job and its follow-up: check right after each finish.
  const idle: string[] = [];
  session.subscribe((e) => {
    if (e.type === "job.finished")
      queueMicrotask(() => !moduleBusy(session.state, "guide") && idle.push(e.payload.job));
  });
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (session.state.jobOrder.length && !moduleBusy(session.state, "guide")) break;
  }
  const last = session.state.jobOrder.at(-1)!;
  expect(idle).toEqual(session.state.jobs[last].status === "finished" ? [last] : []);
  return {
    session,
    harness,
    runner,
    kinds: session.state.jobOrder.map((id) => `${id}:${session.state.jobs[id].status}`),
  };
}

test("a guide the review accepts goes to the reader as is", async () => {
  const { session, kinds } = await run(["accept"]);
  expect(kinds).toEqual(["guide-1:finished", "review-1:finished"]);
  expect(latestDone(session.state, "guide")).toBe("guide-1");
});

test('"revise" starts a revision that reads the guide and the findings, then is reviewed again', async () => {
  const { session, harness, kinds } = await run(["revise", "accept"]);
  expect(kinds).toEqual(["guide-1:finished", "review-1:finished", "guide-2:finished", "review-2:finished"]);
  expect(session.state.jobs["guide-2"].inputs).toEqual(["guide-1", "review-1"]);
  const revisionPrompt = harness.prompts.submit_guide[1];
  expect(revisionPrompt).toMatch(/^Revise this guide/);
  expect(revisionPrompt).toContain("Chapter 0 (brief): Long. Fix: Cut.");
  // The review sees the guide and the task, not the guide job's conversation.
  expect(harness.prompts.submit_review[0]).toContain('"title": "T"');
  // Reviews are stored with the session.
  expect(await session.readResult(session.state.jobs["review-1"].result!)).toMatchObject({ verdict: "revise" });
});

test("revisions stop at the cap, and the reader gets the latest valid guide", async () => {
  const { session, kinds } = await run(["revise", "revise", "revise"]);
  expect(kinds).toEqual(["guide-1:finished", "review-1:finished", "guide-2:finished", "review-2:finished"]);
  expect(latestDone(session.state, "guide")).toBe("guide-2");
});

test("a guide whose review fails isn't shown; the failure is", async () => {
  const { session, kinds } = await run([]);
  expect(kinds).toEqual(["guide-1:finished", "review-1:failed"]);
  expect(latestDone(session.state, "guide")).toBeUndefined();
  expect(session.state.jobs["review-1"].error).toBe("the reviewer crashed");
  const { unavailable } = await import("../../shared/modules");
  const quizLike = { name: "q", label: "Quiz", icon: [], needsJob: true, results: ["guide"] };
  expect(unavailable(quizLike, session.state)).toBe("Quiz needs a finished guide");
});

test("once a failed review is retried and passes, the guide is shown", async () => {
  const { session, harness, runner } = await run([]);
  (harness as unknown as { verdicts: string[] }).verdicts.push("accept");
  runner.retry("review-1");
  for (let i = 0; i < 300 && session.state.jobs["review-2"]?.status !== "finished"; i++)
    await new Promise((r) => setTimeout(r, 10));
  expect(latestDone(session.state, "guide")).toBe("guide-1");
});

test("a review can only cite chapters the guide has", async () => {
  const { reviewJob } = await import("./review");
  const ctx = {
    repo,
    subject: { type: "question" as const, question: "Q?" },
    label: "",
    inputs: { "guide-1": { chapters: [chapter("x")] } },
  };
  const bad = { verdict: "revise", findings: [{ chapter: 3, rule: "brief", problem: "p", fix: "f" }] };
  expect((await reviewJob.submit.validate(bad, ctx)).problems).toEqual([
    expect.objectContaining({ level: "error", message: "the guide has only 1 chapters" }),
  ]);
  expect((await reviewJob.submit.validate({ verdict: "revise", findings: [] }, ctx)).problems).toHaveLength(1);
  expect((await reviewJob.submit.validate({ verdict: "nope", findings: [] }, ctx)).problems[0].where).toBe("verdict");
});

test("the revision cap counts each guide's own chain, not every guide in the session", async () => {
  const { session } = await run(["revise", "accept"]);
  // A second guide started later in the same session still gets its revision.
  const harness = new Scripted(["revise", "accept"]);
  const runner = new JobRunner(session, harness);
  followUps(session, runner, [guide]);
  runner.start(guide.job!, "guide");
  for (let i = 0; i < 300 && (moduleBusy(session.state, "guide") || session.state.jobOrder.length < 8); i++)
    await new Promise((r) => setTimeout(r, 10));
  expect(session.state.jobOrder.slice(4)).toEqual(["guide-3", "review-3", "guide-4", "review-4"]);
  expect(session.state.jobs["guide-4"].inputs).toEqual(["guide-3", "review-3"]);
});

test("a module needing a guide waits for its review to settle", async () => {
  const { unavailable } = await import("../../shared/modules");
  const session = await Session.create(repo);
  session.append("session.subject", { subject: { type: "question", question: "Q?" }, label: "" });
  const quizLike = { name: "q", label: "Quiz", icon: [], needsJob: true, results: ["guide"] };
  expect(unavailable(quizLike, session.state)).toBe("Quiz needs a finished guide");
  session.append("job.queued", { job: "guide-1", kind: "guide", module: "guide", inputs: [] });
  session.append("job.finished", { job: "guide-1", result: "results/guide-1.json", warnings: [] });
  session.append("job.queued", { job: "review-1", kind: "review", module: "guide", inputs: ["guide-1"] });
  expect(unavailable(quizLike, session.state)).toBe("Quiz waits for the guide to finish");
  session.append("job.finished", { job: "review-1", result: "results/review-1.json", warnings: [] });
  expect(unavailable(quizLike, session.state)).toBeUndefined();
});
