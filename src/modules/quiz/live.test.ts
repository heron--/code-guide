import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ClaudeHarness } from "../../server/harness/claude";
import { JobRunner } from "../../server/jobs";
import { Session } from "../../server/session";
import guide from "../guide/module";
import quiz from "./module";

// Writes a real guide and a quiz on it with Claude: opt in with CODE_GUIDE_LIVE=1.
describe.runIf(process.env.CODE_GUIDE_LIVE)("quiz job, live", () => {
  let repo: string;
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "cg-live-"));
    execFileSync("git", ["clone", "-q", process.cwd(), repo]);
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  test("writes a valid quiz about a finished guide", async () => {
    const session = await Session.create(repo);
    session.append("session.subject", {
      subject: { type: "question", question: "How does a job end?" },
      label: "",
    });
    const runner = new JobRunner(session, new ClaudeHarness(process.env.CODE_GUIDE_MODEL));
    const settled = (id: string) => ["finished", "failed"].includes(session.state.jobs[id].status);
    const g = runner.start(guide.job!, "guide");
    while (!settled(g)) await new Promise((r) => setTimeout(r, 500));
    const q = runner.start(quiz.job!, "quiz", [g]);
    while (!settled(q)) await new Promise((r) => setTimeout(r, 500));
    const job = session.state.jobs[q];
    console.log(q, job.status, job.attempts, "attempts", job.error ?? "");
    if (job.result) console.log(JSON.stringify(await session.readResult(job.result), null, 2));
    expect(job.status).toBe("finished");
  }, 900_000);
});
