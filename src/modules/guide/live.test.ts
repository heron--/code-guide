import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Subject } from "../../shared/protocol";
import { ClaudeHarness } from "../../server/harness/claude";
import { JobRunner } from "../../server/jobs";
import { followUps } from "../../server/requests";
import { latestDone, moduleBusy } from "../../shared/modules";
import { Session } from "../../server/session";
import guide from "./module";

// Writes real guides about this repository with Claude: opt in with CODE_GUIDE_LIVE=1. Takes minutes.
describe.runIf(process.env.CODE_GUIDE_LIVE)("guide job, live", () => {
  let repo: string;
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "cg-live-"));
    execFileSync("git", ["clone", "-q", process.cwd(), repo]);
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  test.each<[string, Subject]>([
    ["a question", { type: "question", question: "How does an anchor in chapter prose scroll the code to its lines?" }],
    ["a change", { type: "change", base: "HEAD~1", head: "HEAD" }],
  ])(
    "writes a valid guide for %s",
    async (_, subject) => {
      const session = await Session.create(repo);
      session.append("session.subject", { subject, label: "" });
      const runner = new JobRunner(session, new ClaudeHarness(process.env.CODE_GUIDE_MODEL));
      followUps(session, runner, [guide]);
      runner.start(guide.job!, "guide");
      while (moduleBusy(session.state, "guide")) await new Promise((r) => setTimeout(r, 500));
      for (const id of session.state.jobOrder) {
        const job = session.state.jobs[id];
        console.log(id, job.status, job.attempts, "attempts", job.error ?? "", JSON.stringify(job.warnings));
        if (job.result) console.log(JSON.stringify(await session.readResult(job.result), null, 2));
      }
      const latest = latestDone(session.state, "guide");
      expect(latest).toBeDefined();
      expect(session.state.jobOrder.some((id) => id.startsWith("review-"))).toBe(true);
    },
    900_000,
  );
});
