import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ClaudeHarness, describeActivity, isReadOnlyGit, staysInside } from "./claude";
import { harnessContract } from "./contract";

describe("read-only Bash", () => {
  test.each([
    "git log --oneline -5",
    "git show HEAD:src/a.ts",
    "git diff main...HEAD -- src",
    "git blame -L 1,9 a.ts",
    "git ls-files --others --exclude-standard -- . ':!.code-guide'",
  ])("allows %s", (c) => expect(isReadOnlyGit(c)).toBe(true));
  test.each([
    "git checkout main",
    "git commit -am x",
    "git log; rm -rf .",
    "git log && touch x",
    "git diff > out.patch",
    "git log $(touch x)",
    "git log `touch x`",
    "cat a.ts",
    "rm a.ts",
    "git branch created",
    "git diff --output=out.patch HEAD",
    "git log --output out.txt",
    "git grep -Ovim x",
    "git grep --open-files-in-pager=sh x",
    "git diff --no-index /etc/passwd a.ts",
    "git -c core.pager=sh log",
    "git diff '--no-index' /etc/passwd a.ts",
    'git log "--output=out.txt"',
  ])("refuses %s", (c) => expect(isReadOnlyGit(c)).toBe(false));
});

test("file tools stay inside the repository", () => {
  expect(staysInside("/repo", { file_path: "/repo/src/a.ts" })).toBe(true);
  expect(staysInside("/repo", { file_path: "src/a.ts" })).toBe(true);
  expect(staysInside("/repo", { pattern: "**/*.ts" })).toBe(true);
  expect(staysInside("/repo", { pattern: "x", path: "/repo" })).toBe(true);
  expect(staysInside("/repo", { file_path: "/etc/passwd" })).toBe(false);
  expect(staysInside("/repo", { file_path: "../other/a.ts" })).toBe(false);
  expect(staysInside("/repo", { pattern: "x", path: "/home" })).toBe(false);
  expect(staysInside("/repo", { pattern: "/etc/*" })).toBe(false);
  expect(staysInside("/repo", { file_path: "/repo-other/a.ts" })).toBe(false);
});

test("a symlink out of the repository doesn't count as inside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "cg-link-"));
  const repo = join(dir, "repo");
  mkdirSync(join(dir, "outside"), { recursive: true });
  mkdirSync(repo);
  writeFileSync(join(dir, "outside", "secret.txt"), "x\n");
  writeFileSync(join(repo, "a.ts"), "x\n");
  // A junction, so Windows allows it without admin rights; elsewhere it's an ordinary directory symlink.
  symlinkSync(join(dir, "outside"), join(repo, "linked"), "junction");
  try {
    expect(staysInside(repo, { file_path: "a.ts" })).toBe(true);
    expect(staysInside(repo, { file_path: "linked/secret.txt" })).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("describes tool calls as activity", () => {
  expect(describeActivity("Read", { file_path: "src/a.ts" })).toBe("Reading src/a.ts");
  expect(describeActivity("Grep", { pattern: "retry" })).toBe("Searching for retry");
  expect(describeActivity("mcp__code-guide__submit_guide", {})).toBe("Using submit_guide");
});

// Talks to a real model: opt in with CODE_GUIDE_LIVE=1.
if (process.env.CODE_GUIDE_LIVE)
  harnessContract(() => new ClaudeHarness(process.env.CODE_GUIDE_MODEL), { timeout: 120_000 });
