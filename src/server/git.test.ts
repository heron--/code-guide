import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { fullFileDiff } from "./git";

const repo = mkdtempSync(join(tmpdir(), "cg-git-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

test("a file name with pathspec characters means only that file", async () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "a[1].ts"), "one\n");
  writeFileSync(join(repo, "a1.ts"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  writeFileSync(join(repo, "a1.ts"), "ONE\n");
  // `a[1].ts` as a pattern would match the changed `a1.ts`.
  expect(await fullFileDiff(repo, "HEAD", undefined, "a[1].ts")).toBeUndefined();
  writeFileSync(join(repo, "b[1].ts"), "new\n");
  writeFileSync(join(repo, "b1.ts"), "new\n");
  expect(await fullFileDiff(repo, "HEAD", undefined, "b[1].ts")).toEqual([{ k: "+", n: 1, text: "new" }]);
});
