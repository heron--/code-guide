import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { FakeHarness } from "./harness/fake";
import type { Harness } from "./harness/types";
import { JobRunner, type JobKind } from "./jobs";
import { Session } from "./session";

let repo: string;
let session: Session;

/** A job the fake harness can do: its prompt tells it exactly what to submit. */
const echo = (kind: string, prompt: (inputs: Record<string, unknown>) => string): JobKind => ({
  kind,
  instructions: "Submit what you're told to.",
  prompt: (ctx) => prompt(ctx.inputs),
  submit: {
    tool: `submit_${kind}`,
    description: "Submit the result.",
    input: z.object({ text: z.string() }),
    validate: async (input) => {
      const { text } = input as { text: string };
      return {
        problems:
          text === "bad"
            ? [{ level: "error", where: "text", message: "can't be bad" }]
            : text === "meh"
              ? [{ level: "warning", where: "text", message: "could be better" }]
              : [],
      };
    },
  },
});
const says = (kind: string, text: string) =>
  echo(kind, () => `Call the \`submit_${kind}\` tool with {"text":"${text}"}.`);

async function until(cond: () => boolean) {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
}
const status = (id: string) => session.state.jobs[id]?.status;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "cg-jobs-"));
  session = await Session.create(repo);
  session.append("session.subject", { subject: { type: "question", question: "How?" }, label: "How?" });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("a job runs, submits, and its result is stored beside the log", async () => {
  const runner = new JobRunner(session, new FakeHarness());
  const id = runner.start(says("guide", "hello"), "guide");
  expect(id).toBe("guide-1");
  await until(() => status(id) === "finished");
  const job = session.state.jobs[id];
  expect(job).toMatchObject({ attempts: 1, warnings: [], result: "results/guide-1.json" });
  expect(await session.readResult(job.result!)).toEqual({ text: "hello" });
  const types = session.eventsAfter(0).map((e) => e.type);
  expect(types).toEqual(
    expect.arrayContaining(["job.queued", "job.started", "job.progress", "job.submitted", "job.finished"]),
  );
});

test("warnings are recorded but don't block", async () => {
  const runner = new JobRunner(session, new FakeHarness());
  const id = runner.start(says("guide", "meh"), "guide");
  await until(() => status(id) === "finished");
  expect(session.state.jobs[id].warnings).toEqual([{ level: "warning", where: "text", message: "could be better" }]);
});

test("jobs run at once, and each lands on its own", async () => {
  const runner = new JobRunner(session, new FakeHarness(5));
  const guide = runner.start(says("guide", "g"), "guide");
  const quiz = runner.start(says("quiz", "q"), "quiz");
  await until(() => status(guide) === "running" && status(quiz) === "running");
  await until(() => status(guide) === "finished" && status(quiz) === "finished");
});

test("over the concurrency limit, jobs wait their turn", async () => {
  const runner = new JobRunner(session, new FakeHarness(5), { concurrency: 1 });
  const a = runner.start(says("guide", "a"), "guide");
  const b = runner.start(says("guide", "b"), "guide");
  expect([status(a), status(b)]).toEqual(["running", "queued"]);
  await until(() => status(a) === "finished");
  await until(() => status(b) === "finished");
});

test("a job reads finished results, never transcripts", async () => {
  const runner = new JobRunner(session, new FakeHarness());
  const guide = runner.start(says("guide", "the guide"), "guide");
  await until(() => status(guide) === "finished");
  const quiz = runner.start(
    echo(
      "quiz",
      (inputs) => `Call the \`submit_quiz\` tool with {"text":"about ${(inputs[guide] as { text: string }).text}"}.`,
    ),
    "quiz",
    [guide],
  );
  await until(() => status(quiz) === "finished");
  expect(await session.readResult(session.state.jobs[quiz].result!)).toEqual({ text: "about the guide" });
  expect(() => runner.start(says("quiz", "x"), "quiz", ["guide-9"])).toThrow(/finished result/);
});

test("a job that won't submit fails with the reason, and can be retried", async () => {
  const runner = new JobRunner(session, new FakeHarness(), { maxNudges: 1 });
  const id = runner.start(says("guide", "bad"), "guide");
  await until(() => status(id) === "failed");
  expect(session.state.jobs[id].error).toMatch(/without an accepted submit_guide/);
  expect(session.state.jobs[id].problems).toEqual([]);
  const again = runner.retry(id);
  expect(again).toBe("guide-2");
  await until(() => status(again) === "failed");
});

test("rejected submissions fail the job once out of attempts", async () => {
  const runner = new JobRunner(session, new FakeHarness(), { maxAttempts: 1 });
  const id = runner.start(says("guide", "bad"), "guide");
  await until(() => status(id) === "failed");
  expect(session.state.jobs[id]).toMatchObject({
    error: "Still had errors after 1 submissions",
    problems: [{ level: "error", message: "can't be bad" }],
  });
});

test("running and queued jobs can be cancelled", async () => {
  const runner = new JobRunner(session, new FakeHarness(5), { concurrency: 1 });
  const slow = runner.start(
    echo("guide", () => "Count from 1 to 400, one number per line."),
    "guide",
  );
  const waiting = runner.start(says("guide", "x"), "guide");
  await runner.cancel(waiting);
  expect(status(waiting)).toBe("cancelled");
  await until(() => session.state.jobs[slow].status === "running");
  await runner.cancel(slow);
  expect(status(slow)).toBe("cancelled");
  await expect(runner.cancel(slow)).rejects.toThrow(/isn't running/);
  // The slot is free again.
  const next = runner.start(says("guide", "y"), "guide");
  await until(() => status(next) === "finished");
});

test("a job cancelled while its inputs are read never starts", async () => {
  const runner = new JobRunner(session, new FakeHarness());
  const guide = runner.start(says("guide", "g"), "guide");
  await until(() => status(guide) === "finished");
  const read = session.readResult.bind(session);
  session.readResult = async (rel) => (await new Promise((r) => setTimeout(r, 50)), read(rel));
  const quiz = runner.start(says("quiz", "q"), "quiz", [guide]);
  await runner.cancel(quiz);
  await new Promise((r) => setTimeout(r, 100));
  expect(status(quiz)).toBe("cancelled");
  expect(session.eventsAfter(0).filter((e) => e.type === "job.started" && e.payload.job === quiz)).toEqual([]);
});

test("a job cancelled while its submission is checked stays cancelled", async () => {
  const slow = says("guide", "x");
  const validate = slow.submit.validate;
  slow.submit = {
    ...slow.submit,
    validate: async (i, c) => (await new Promise((r) => setTimeout(r, 50)), validate(i, c)),
  };
  const runner = new JobRunner(session, new FakeHarness());
  const id = runner.start(slow, "guide");
  await until(() => session.state.jobs[id].activity !== undefined);
  await runner.cancel(id);
  await new Promise((r) => setTimeout(r, 100));
  expect(status(id)).toBe("cancelled");
  expect(session.eventsAfter(0).some((e) => e.type === "job.submitted" || e.type === "job.finished")).toBe(false);
});

test("a harness that dies after an accepted submission still frees its slot", async () => {
  // Turns end with a fatal error instead of turn.end, as the Claude adapter does when its process exits.
  const fake = new FakeHarness();
  const dying: Harness = {
    name: "dying",
    model: "scripted",
    check: () => fake.check(),
    start: (opts) =>
      fake.start({
        ...opts,
        onEvent: (e) => opts.onEvent(e.type === "turn.end" ? { type: "error", message: "exited", fatal: true } : e),
      }),
  };
  const runner = new JobRunner(session, dying, { concurrency: 1 });
  const a = runner.start(says("guide", "a"), "guide");
  await until(() => status(a) === "finished");
  const b = runner.start(says("guide", "b"), "guide");
  await until(() => status(b) === "finished");
});

test("a result written in parts: each write is checked, progress counts them, and submit sees them all", async () => {
  const kind: JobKind = {
    kind: "trace",
    instructions: "",
    prompt: (ctx) =>
      `Call the \`write_parts\` tool with {"from":0,"parts":["a","bad"]}. ` +
      `Call the \`write_parts\` tool with {"from":0,"parts":["a","b"]}. ` +
      `Call the \`write_parts\` tool with {"from":2,"parts":["c"]}. ` +
      `Call the \`submit_trace\` tool with {"pick":${ctx.pick}}.`,
    submit: {
      tool: "submit_trace",
      description: "",
      input: z.object({ pick: z.number() }),
      validate: async (input, _ctx, written) => ({ problems: [], result: { ...(input as object), parts: written } }),
    },
    parts: {
      tool: "write_parts",
      description: "",
      input: z.object({ from: z.number(), parts: z.array(z.string()) }),
      activity: (n) => `${n} parts written`,
      write: async (input, written) => {
        const { from, parts } = input as { from: number; parts: string[] };
        if (parts.includes("bad")) return { problems: [{ level: "error", where: "parts", message: "bad" }] };
        return { problems: [], written: [...written.slice(0, from), ...parts] };
      },
    },
  };
  const runner = new JobRunner(session, new FakeHarness());
  const id = runner.start(kind, "trace", [], 1);
  await until(() => status(id) === "finished");
  expect(await session.readResult(session.state.jobs[id].result!)).toEqual({ pick: 1, parts: ["a", "b", "c"] });
  expect(session.state.jobs[id]).toMatchObject({ pick: 1, written: 3 });
  const written = session.eventsAfter(0).flatMap((e) => (e.type === "job.progress" && e.payload.written) || []);
  expect(written).toEqual([2, 3]);
  // A retry keeps the reader's pick.
  await runner.cancel(runner.start(kind, "trace", [], 2)).catch(() => {});
  const again = runner.retry("trace-2");
  expect(session.state.jobs[again].pick).toBe(2);
});
