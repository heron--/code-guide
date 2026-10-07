import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import overview, { SUMMARY_WORDS } from "./module";

let repo: string;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cg-overview-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.ts"), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const validate = (summary: string) =>
  overview.job!.submit.validate(
    { summary },
    { repo, subject: { type: "question", question: "Q?" }, label: "", inputs: {} },
  );

test("a brief summary with good anchors is accepted as is", async () => {
  const summary = "Retries live in [the retry check](a.ts#L2-L4).\n\nThat's all.";
  expect(await validate(summary)).toEqual({ problems: [], result: { summary } });
});

test("long summaries, bad links and missing lines are rejected", async () => {
  const long = await validate(Array.from({ length: SUMMARY_WORDS + 1 }, () => "word").join(" "));
  expect(long.problems[0].message).toMatch(/words/);
  const messages = (await validate("See [it](a.ts) and [that](a.ts#L19-L25) and [b](b.ts#L1).")).problems.map(
    (p) => p.message,
  );
  expect(messages).toEqual([
    "[it](a.ts) isn't a link to lines (path#L1-L2)",
    "lines 19-25 aren't in a.ts (20 lines)",
    "b.ts doesn't exist",
  ]);
});
