import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { submitGuide, type GuideSubmission } from "./submit";
import type { Harness, HarnessSessionOptions } from "../../server/harness/types";
import { JobRunner, type JobKind } from "../../server/jobs";
import { Session } from "../../server/session";

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cg-submit-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.ts"), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const good: GuideSubmission = {
  title: "Line twelve",
  question: "What is on line twelve?",
  answer: "Line twelve says so.",
  chapters: [
    {
      title: "Read line twelve",
      body: "The file names [its twelfth line](a.ts#L12) plainly.",
      excerpts: [{ path: "a.ts", lines: ["10-14"] }],
    },
  ],
};
// Out of bounds, and an anchor to a file the chapter doesn't show.
const broken: GuideSubmission = {
  ...good,
  chapters: [{ ...good.chapters[0], body: "See [the end](b.ts#L1).", excerpts: [{ path: "a.ts", lines: ["10-40"] }] }],
};

/** A harness whose agent submits a broken guide, reads the errors, then submits a fixed one. */
class FixingHarness implements Harness {
  name = "scripted";
  model = "fixer";
  replies: string[] = [];
  async check() {
    return { ok: true as const };
  }
  start(opts: HarnessSessionOptions) {
    const submit = opts.tools.find((t) => t.name === "submit_guide")!;
    return {
      send: async () => {
        opts.onEvent({ type: "activity", activity: "Reading a.ts" });
        for (const attempt of [broken, good]) {
          const r = await submit.run(attempt);
          this.replies.push(r.text);
          if (!r.isError) break;
        }
        opts.onEvent({ type: "turn.end" });
      },
      cancel: async () => {},
      stop: async () => {},
    };
  }
}

const guideJob: JobKind = { kind: "guide", instructions: "", prompt: () => "Write the guide.", submit: submitGuide };

test("a broken guide is rejected, fixed and accepted within one job", async () => {
  const session = await Session.create(repo);
  session.append("session.subject", { subject: { type: "question", question: "What is on line twelve?" }, label: "" });
  const harness = new FixingHarness();
  const id = new JobRunner(session, harness).start(guideJob, "guide");
  for (let i = 0; i < 200 && session.state.jobs[id].status !== "finished"; i++)
    await new Promise((r) => setTimeout(r, 10));

  const submitted = session.eventsAfter(0).filter((e) => e.type === "job.submitted");
  expect(submitted.map((e) => e.payload)).toEqual([
    expect.objectContaining({ attempt: 1, accepted: false }),
    expect.objectContaining({ attempt: 2, accepted: true, problems: [] }),
  ]);
  const errors = submitted[0].type === "job.submitted" ? submitted[0].payload.problems.map((p) => p.message) : [];
  expect(errors).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/past the end of the file/),
      expect.stringMatching(/isn't one of this chapter's excerpts/),
    ]),
  );
  // The agent was told exactly what to fix.
  expect(harness.replies[0]).toMatch(/^Rejected\. Fix these errors/);
  expect(harness.replies[0]).toMatch(/past the end of the file/);

  expect(session.state.jobs[id].status).toBe("finished");
  expect(await session.readResult(session.state.jobs[id].result!)).toEqual({
    spec: "code-chapters/v1",
    subject: { type: "question" },
    ...good,
  });
});

test("a submission that doesn't match the schema gets schema errors", async () => {
  const ctx = { repo, subject: { type: "change" as const, base: "HEAD" }, label: "", inputs: {} };
  const { problems } = await submitGuide.validate({ title: "x" }, ctx);
  expect(problems.map((p) => p.where)).toEqual(expect.arrayContaining(["question", "answer", "chapters"]));
});
