import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { modules } from "../modules";
import { defineModule } from "../modules/types";
import { FakeHarness } from "./harness/fake";
import { JobRunner } from "./jobs";
import { labelQuestions, requestHandler, subjectLabel } from "./requests";
import { Session } from "./session";

/** A fifth module, defined entirely here: the registry and runner need nothing else to run it. */
const echo = (name: string, results?: string[]) =>
  defineModule({
    name,
    label: name[0].toUpperCase() + name.slice(1),
    icon: ["M3 3h10v10H3z"],
    results,
    job: {
      kind: name,
      instructions: "",
      prompt: (ctx) => `Call the \`submit_${name}\` tool with {"text":"read ${Object.keys(ctx.inputs).join(",")}"}.`,
      submit: {
        tool: `submit_${name}`,
        description: "",
        input: z.object({ text: z.string() }),
        validate: async () => ({ problems: [] }),
      },
    },
  });

let repo: string;
let session: Session;
let handle: ReturnType<typeof requestHandler>;
let runner: JobRunner;

async function until(cond: () => boolean) {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "cg-requests-"));
  session = await Session.create(repo);
  runner = new JobRunner(session, new FakeHarness());
  handle = requestHandler(session, runner, [...modules, echo("echo"), echo("recap", ["echo"])]);
});
afterEach(async () => {
  for (const id of session.state.jobOrder)
    if (["queued", "running"].includes(session.state.jobs[id].status)) await runner.cancel(id);
  rmSync(repo, { recursive: true, force: true });
});

/** Calls labelQuestions' listener as if the guide job had finished with `result`. */
function finishGuide(result: unknown) {
  let finished: (job: string, result: unknown) => void = () => {};
  labelQuestions(session, { onFinished: (fn) => ((finished = fn), () => {}) });
  session.append("job.queued", { job: "guide-1", kind: "guide", module: "guide", inputs: [] });
  finished("guide-1", result);
}

test("a question is relabelled with its guide's title", () => {
  const question = "When the retry budget runs out mid-request, which component decides whether to fail?";
  session.append("session.subject", { subject: { type: "question", question }, label: question });
  finishGuide({ title: "Who gives up when retries run out" });
  expect(session.state.subject?.label).toBe("Who gives up when retries run out");
});

test("other subjects keep their labels", () => {
  session.append("session.subject", { subject: { type: "path", path: "src/retry" }, label: "src/retry" });
  finishGuide({ title: "How src/retry works" });
  expect(session.state.subject?.label).toBe("src/retry");
});

test("labels subjects for the status bar", () => {
  expect(subjectLabel({ type: "change", base: "main", head: "feat/retry-policy" })).toBe("feat/retry-policy vs main");
  expect(subjectLabel({ type: "change", base: "main" })).toBe("working tree vs main");
  expect(subjectLabel({ type: "change", base: "origin/main", head: "3f9c2a1", pr: 12 })).toBe("#12 vs origin/main");
  expect(subjectLabel({ type: "path", path: "src/retry" })).toBe("src/retry");
});

test("a session takes one subject", async () => {
  await expect(handle({ type: "job.start", module: "echo" })).rejects.toThrow(/Choose a subject/);
  await handle({ type: "subject.choose", subject: { type: "path", path: "src" } });
  expect(session.state.subject).toEqual({ subject: { type: "path", path: "src" }, label: "src" });
  await expect(handle({ type: "subject.choose", subject: { type: "path", path: "lib" } })).rejects.toThrow(/already/);
});

test("a change whose ref doesn't resolve is refused before anything starts", async () => {
  // The temp directory isn't a repository, so not even HEAD resolves (as in one with no commits yet).
  await expect(handle({ type: "subject.choose", subject: { type: "change", base: "HEAD" } })).rejects.toThrow(
    'unknown ref "HEAD"',
  );
  expect(session.state.subject).toBeUndefined();
  expect(session.state.jobOrder).toEqual([]);
});

test("choosing a subject starts the guide job", async () => {
  await handle({ type: "subject.choose", subject: { type: "path", path: "src" } });
  expect(session.state.jobs["guide-1"]).toMatchObject({ module: "guide", kind: "guide" });
});

test("starts a module's job, and refuses modules that can't start", async () => {
  await handle({ type: "subject.choose", subject: { type: "path", path: "src" } });
  await expect(handle({ type: "job.start", module: "nope" })).rejects.toThrow(/No module named "nope"/);
  await expect(handle({ type: "job.start", module: "chat" })).rejects.toThrow(/opens without a job/);
  await expect(handle({ type: "job.start", module: "recap" })).rejects.toThrow(/needs a finished echo/);
  await handle({ type: "job.start", module: "echo" });
  await until(() => session.state.jobs["echo-1"]?.status === "finished");
  // Its required results become its inputs.
  await handle({ type: "job.start", module: "recap" });
  await until(() => session.state.jobs["recap-1"]?.status === "finished");
  expect(session.state.jobs["recap-1"].inputs).toEqual(["echo-1"]);
  expect(await session.readResult(session.state.jobs["recap-1"].result!)).toEqual({ text: "read echo-1" });
});

test("cancels and retries jobs", async () => {
  await handle({ type: "subject.choose", subject: { type: "path", path: "src" } });
  await handle({ type: "job.start", module: "echo" });
  await handle({ type: "job.cancel", job: "echo-1" });
  expect(session.state.jobs["echo-1"].status).toBe("cancelled");
  await handle({ type: "job.start", module: "echo", retry: "echo-1" });
  await until(() => session.state.jobs["echo-2"]?.status === "finished");
});

test("updating a subject needs new commits on its pull request", async () => {
  await handle({ type: "subject.choose", subject: { type: "question", question: "Q?" } });
  await expect(handle({ type: "subject.update" })).rejects.toThrow("No new commits");
});
