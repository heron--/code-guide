import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { parseInput, prepareChange, preparePullRequest, pullRequestFor, suggestions } from "./subjects";

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
  mkdirSync(join(repo, "src/retry policy"), { recursive: true });
  writeFileSync(join(repo, "src/retry/policy.ts"), "x\n");
  mkdirSync(join(repo, ".code-guide/sessions/s"), { recursive: true });
  writeFileSync(join(repo, ".code-guide/sessions/s/events.jsonl"), "{}\n");

  // A stand-in for the gh CLI that knows one open pull request: a Node script, with a shell and a Windows shim.
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "gh.js"),
    `const [, , , cmd] = process.argv;
if (cmd === "list") console.log('[{"number":7,"title":"Fix retries","author":{"login":"sam"},"baseRefName":"main"}]');
if (cmd === "view" && process.argv.includes("headRefOid,baseRefName"))
  console.log('{"headRefOid":"${prCommit}","baseRefName":"main"}');
else if (cmd === "view") console.log(JSON.stringify({ number: 8, title: process.argv[4], url: "u", body: "" }));
`,
  );
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec node "$(dirname "$0")/gh.js" "$@"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(bin, "gh.cmd"), `@node "%~dp0gh.js" %*\r\n`);
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
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
  expect(await parseInput(repo, "src/retry policy")).toEqual({ type: "path", path: "src/retry policy" });
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

test("a pull request's base is kept even when the clone only tracks another branch", async () => {
  const other = join(dir, "other");
  git(dir, "clone", "-q", "--single-branch", "-b", "contributor/fix", origin, other);
  const s = await preparePullRequest(other, { type: "change", base: "main", pr: 7 });
  expect(s).toMatchObject({ base: "origin/main", head: prCommit });
  expect(git(other, "rev-parse", "--verify", "origin/main")).toBe(git(origin, "rev-parse", "main"));
});

test("suggests unpushed commits on the default branch itself", async () => {
  const own = join(dir, "own");
  git(dir, "clone", "-q", origin, own);
  git(own, "config", "user.email", "t@t");
  git(own, "config", "user.name", "t");
  commit(own, "d.ts", "local");
  const s = await suggestions(own);
  expect(s.find((x) => x.title === "main vs origin/main")?.detail).toBe("1 commit ahead");
});

test("a change ending at HEAD finds the pull request for the current branch", async () => {
  expect(await pullRequestFor(repo, { type: "change", base: "main", head: "HEAD" })).toMatchObject({
    number: 8,
    title: "feature",
  });
});

test("a change ending at a remote-tracking branch finds that branch's pull request", async () => {
  expect(await pullRequestFor(repo, { type: "change", base: "main", head: "origin/main" })).toMatchObject({
    title: "main",
  });
});

test("a change's base is fetched first, so a stale copy doesn't pull in others' commits", async () => {
  const stale = join(dir, "stale");
  git(dir, "clone", "-q", origin, stale);
  git(stale, "config", "user.email", "t@t");
  git(stale, "config", "user.name", "t");
  const old = git(stale, "rev-parse", "origin/main");
  // Someone else lands on main; this clone's branch forks from it, then its copies of main fall behind.
  commit(origin, "theirs.ts", "theirs");
  const tip = git(origin, "rev-parse", "main");
  git(stale, "fetch", "-q");
  git(stale, "checkout", "-qb", "mine", "origin/main");
  commit(stale, "mine.ts", "mine");
  git(stale, "update-ref", "refs/remotes/origin/main", old);

  const remote = await prepareChange(stale, { type: "change", base: "origin/main", head: "mine" });
  expect(remote).toEqual({ type: "change", base: "origin/main", head: "mine" });
  expect(git(stale, "rev-parse", "origin/main")).toBe(tip);

  // A local main that's only behind its upstream is compared as the upstream.
  git(stale, "update-ref", "refs/remotes/origin/main", old);
  expect(await prepareChange(stale, { type: "change", base: "main", head: "mine" })).toMatchObject({
    base: "origin/main",
  });
  expect(git(stale, "rev-parse", "origin/main")).toBe(tip);

  // One with commits of its own stays as it is.
  git(stale, "checkout", "-q", "main");
  commit(stale, "local.ts", "local");
  expect(await prepareChange(stale, { type: "change", base: "main", head: "mine" })).toMatchObject({ base: "main" });
  // Nothing to fetch from: the local copy is used.
  expect(await prepareChange(repo, { type: "change", base: "HEAD" })).toEqual({ type: "change", base: "HEAD" });
});
