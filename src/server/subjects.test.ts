import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { parseInput, preparePullRequest, suggestions } from "./subjects";

let dir: string;
let repo: string;
let origin: string;
let prCommit: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = (cwd: string, file: string, msg: string) => {
  writeFileSync(join(cwd, file), msg + "\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", msg);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cg-subjects-"));
  origin = join(dir, "origin");
  repo = join(dir, "repo");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  git(origin, "config", "user.email", "t@t");
  git(origin, "config", "user.name", "t");
  commit(origin, "a.ts", "base");
  // A pull request's head: a commit on a branch only the remote has.
  git(origin, "checkout", "-qb", "contributor/fix");
  commit(origin, "fix.ts", "fix");
  prCommit = git(origin, "rev-parse", "HEAD");
  git(origin, "checkout", "-q", "main");

  git(dir, "clone", "-q", "--single-branch", "-b", "main", origin, repo);
  git(repo, "config", "user.email", "t@t");
  git(repo, "config", "user.name", "t");
  git(repo, "checkout", "-qb", "feature");
  commit(repo, "b.ts", "one");
  commit(repo, "c.ts", "two");
  mkdirSync(join(repo, "src/retry"), { recursive: true });
  writeFileSync(join(repo, "src/retry/policy.ts"), "x\n");
  mkdirSync(join(repo, ".code-guide/sessions/s"), { recursive: true });
  writeFileSync(join(repo, ".code-guide/sessions/s/events.jsonl"), "{}\n");

  // A stand-in for the gh CLI that knows one open pull request.
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
case "$2" in
  list) echo '[{"number":7,"title":"Fix retries","author":{"login":"sam"},"baseRefName":"main"}]' ;;
  view) echo '{"headRefOid":"${prCommit}","baseRefName":"main"}' ;;
esac
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("suggests uncommitted work, the branch, and open pull requests", async () => {
  const s = await suggestions(repo);
  expect(s.map((x) => [x.title, x.detail])).toEqual([
    ["Uncommitted changes", "1 file changed in the working tree"],
    ["feature vs origin/main", "2 commits ahead"],
    ["#7 Fix retries", "Pull request by sam into main"],
  ]);
  expect(s[0].subject).toEqual({ type: "change", base: "HEAD" });
  expect(s[1].subject).toEqual({ type: "change", base: "origin/main", head: "feature" });
});

test("reads typed input as a range, a path, or a question", async () => {
  expect(await parseInput(repo, "main...feature")).toEqual({ type: "change", base: "main", head: "feature" });
  expect(await parseInput(repo, "HEAD~1..HEAD")).toEqual({ type: "change", base: "HEAD~1", head: "HEAD" });
  expect(await parseInput(repo, "src/retry/")).toEqual({ type: "path", path: "src/retry" });
  expect(await parseInput(repo, "How do retries work?")).toEqual({
    type: "question",
    question: "How do retries work?",
  });
  expect(await parseInput(repo, "../outside")).toEqual({ type: "question", question: "../outside" });
});

test("a pull request is fetched and pinned to its head commit", async () => {
  expect(await preparePullRequest(repo, { type: "change", base: "main", pr: 7 })).toEqual({
    type: "change",
    base: "origin/main",
    head: prCommit,
    pr: 7,
  });
  expect(git(repo, "cat-file", "-t", prCommit)).toBe("commit");
  // No branch was created for it.
  expect(git(repo, "branch", "--list", "contributor/*")).toBe("");
});
