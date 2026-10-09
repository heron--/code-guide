import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Subject } from "../shared/protocol";
import { FakeHarness } from "./harness/fake";
import { JobRunner } from "./jobs";
import { requestHandler } from "./requests";
import { startServer } from "./server";
import { Session } from "./session";
import {
  branchChange,
  parseInput,
  parseSubjectInputs,
  prepareChange,
  preparePullRequest,
  pullRequestFor,
  pullRequestNumber,
  suggestions,
} from "./subjects";

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
  git(repo, "remote", "add", "upstream", origin);
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
    `const [, , kind, cmd] = process.argv;
if (kind === "repo" && cmd === "view") {
  if (process.env.CODE_GUIDE_TEST_REPO_UNAVAILABLE) {
    console.error("Cannot identify repository");
    process.exit(1);
  }
  console.log('{"url":"https://github.com/acme/app"}');
}
if (cmd === "list") console.log('[{"number":7,"title":"Fix retries","author":{"login":"sam"},"baseRefName":"main"}]');
if (kind === "pr" && cmd === "view" && process.argv.includes("headRefOid,baseRefName"))
  console.log('{"headRefOid":"${prCommit}","baseRefName":"main"}');
else if (kind === "pr" && cmd === "view") console.log(JSON.stringify({ number: 8, title: process.argv[4], url: "u", body: "" }));
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

test("blank inputs explain the repository and a question keeps its existing interpretation", async () => {
  expect(await parseSubjectInputs(repo, {})).toEqual({ type: "path", path: "." });
  expect(await parseSubjectInputs(repo, { source: "  ", target: " ", question: "\n" })).toEqual({
    type: "path",
    path: ".",
  });
  for (const question of ["How do retries work?", "src/retry/", "main...feature", "#7", "feature"])
    expect(await parseSubjectInputs(repo, { question })).toEqual(await parseInput(repo, question));
});

test("source and target choose branches, with an optional question about their change", async () => {
  expect(await parseSubjectInputs(repo, { source: " feature " })).toEqual({
    type: "change",
    base: "origin/main",
    head: "refs/heads/feature",
  });
  expect(await parseSubjectInputs(repo, { source: "feature", target: " main ", question: " Why retries? " })).toEqual({
    type: "change",
    base: "refs/heads/main",
    head: "refs/heads/feature",
    question: "Why retries?",
  });
  // With a source, even a question that looks like another subject remains the reader's question.
  expect(await parseSubjectInputs(repo, { source: "feature", question: "#7" })).toMatchObject({ question: "#7" });
});

test("branches default to local, never a same-named tag", async () => {
  git(repo, "tag", "--no-sign", "feature", "main");
  try {
    const subject = await parseSubjectInputs(repo, { source: "feature", target: "feature" });
    expect(subject).toEqual({ type: "change", base: "refs/heads/feature", head: "refs/heads/feature" });
  } finally {
    git(repo, "tag", "-d", "feature");
  }
});

test("source falls back to origin, and explicit remotes work for either branch before they are fetched", async () => {
  git(origin, "branch", "remote/source", prCommit);
  git(origin, "branch", "remote/target", "main");
  const subject = await parseSubjectInputs(repo, { source: "remote/source", target: "upstream/remote/target" });
  expect(subject).toEqual({
    type: "change",
    base: "refs/remotes/upstream/remote/target",
    head: "refs/remotes/origin/remote/source",
  });
  await prepareChange(repo, subject as Subject & { type: "change" });
  expect(git(repo, "rev-parse", "refs/remotes/origin/remote/source")).toBe(prCommit);
  expect(git(repo, "rev-parse", "refs/remotes/upstream/remote/target")).toBe(git(origin, "rev-parse", "main"));
  expect(await parseSubjectInputs(repo, { source: "upstream/contributor/fix", target: "origin/main" })).toEqual({
    type: "change",
    base: "refs/remotes/origin/main",
    head: "refs/remotes/upstream/contributor/fix",
  });
  await expect(parseSubjectInputs(repo, { source: "feature", target: "remote/target" })).rejects.toThrow(
    'Target branch "remote/target" not found',
  );
});

test.each(["-feature", "feature..fast", "feature fast", "feature*", "feature~1", "feature^", "HEAD", "@{-1}"])(
  "rejects an invalid branch input: %s",
  async (name) => {
    await expect(parseSubjectInputs(repo, { source: name })).rejects.toThrow("Source must be a branch");
    await expect(parseSubjectInputs(repo, { source: "feature", target: name })).rejects.toThrow(
      "Target must be a branch",
    );
  },
);

test("rejects a missing branch rather than turning it into a question", async () => {
  await expect(parseSubjectInputs(repo, { source: "no-such-branch" })).rejects.toThrow(
    'Source branch "no-such-branch" not found',
  );
  await expect(parseSubjectInputs(repo, { source: "feature", target: "origin/no-such-branch" })).rejects.toThrow(
    'Target branch "origin/no-such-branch" not found',
  );
});

test("a source without a default branch needs an explicit target", async () => {
  const local = join(dir, "no-default");
  mkdirSync(local);
  git(local, "init", "-q", "-b", "topic");
  git(local, "config", "user.email", "t@t");
  git(local, "config", "user.name", "t");
  commit(local, "a.ts", "first");
  await expect(parseSubjectInputs(local, { source: "topic" })).rejects.toThrow(
    "No default branch found; specify a target",
  );
  expect(await parseSubjectInputs(local, { source: "topic", target: "topic" })).toEqual({
    type: "change",
    base: "refs/heads/topic",
    head: "refs/heads/topic",
  });
});

test("rejects a target without a source, including when there's a question", async () => {
  for (const input of [{ target: "main" }, { source: "  ", target: "main", question: "Why?" }])
    await expect(parseSubjectInputs(repo, input)).rejects.toThrow("Target requires a source");
});

test("reads a branch name as what it changes, fetching one only origin has", async () => {
  expect(await parseInput(repo, "feature")).toEqual({ type: "change", base: "origin/main", head: "feature" });
  const remote = await parseInput(repo, "contributor/fix");
  expect(remote).toEqual({ type: "change", base: "origin/main", head: "origin/contributor/fix" });
  await prepareChange(repo, remote as Subject & { type: "change" });
  expect(git(repo, "rev-parse", "origin/contributor/fix")).toBe(prCommit);
  expect(await parseInput(repo, "no-such-branch")).toEqual({ type: "question", question: "no-such-branch" });
});

test.each(["feature+fast", "feature=fast", "feature%fast", "feature,fast", "機能"])(
  "reads the valid Git branch name %s locally and on origin",
  async (name) => {
    git(repo, "branch", name, "feature");
    const local = { type: "change", base: "origin/main", head: name };
    expect(await branchChange(repo, name)).toEqual(local);
    expect(await parseInput(repo, name)).toEqual(local);

    const remoteName = `contributor/${name}`;
    git(origin, "branch", remoteName, prCommit);
    const remote = await parseInput(repo, remoteName);
    expect(remote).toEqual({ type: "change", base: "origin/main", head: `origin/${remoteName}` });
    await prepareChange(repo, remote as Subject & { type: "change" });
    expect(git(repo, "rev-parse", `origin/${remoteName}`)).toBe(prCommit);
    expect(await branchChange(repo, remoteName)).toEqual(remote);
  },
);

test.each(["-feature", "feature..fast", "feature fast", "feature*", "feature~1", "feature^"])(
  "does not read the invalid branch name %s as a branch",
  async (name) => {
    expect(await branchChange(repo, name)).toBeUndefined();
  },
);

test("reads a pull request link or number", async () => {
  const pr = { type: "change", base: "origin/main", pr: 7 };
  expect(await parseInput(repo, "https://github.com/acme/app/pull/7")).toEqual(pr);
  expect(await parseInput(repo, "https://github.com/acme/app/pull/7/files#diff-1")).toEqual(pr);
  expect(await parseInput(repo, "https://github.com/Acme/App/pull/7?tab=commits")).toEqual(pr);
  expect(await parseInput(repo, "#7")).toEqual(pr);
  expect(await pullRequestNumber(repo, "https://github.com/acme/app/issues/7")).toBeUndefined();
});

test.each([
  "https://github.com/other/app/pull/7",
  "https://github.com/acme/other/pull/7/files#diff-1",
  "https://other.example.com/acme/app/pull/7",
])("rejects a pull request link outside the session repository: %s", async (link) => {
  await expect(pullRequestNumber(repo, link)).rejects.toThrow("Pull request link must belong to github.com/acme/app");
  await expect(parseInput(repo, link)).rejects.toThrow("Pull request link must belong to github.com/acme/app");
});

test("numbers work without repository lookup, but links require a verified repository", async () => {
  process.env.CODE_GUIDE_TEST_REPO_UNAVAILABLE = "1";
  try {
    expect(await parseInput(repo, "#7")).toEqual({ type: "change", base: "origin/main", pr: 7 });
    await expect(parseInput(repo, "https://github.com/acme/app/pull/7")).rejects.toThrow("Cannot identify repository");
  } finally {
    delete process.env.CODE_GUIDE_TEST_REPO_UNAVAILABLE;
  }
});

test("the subject API rejects a mismatched pull request link without choosing a subject", async () => {
  const session = await Session.create(repo);
  const server = await startServer({ session, onRequest: async () => {}, uiDir: repo, port: 0 });
  try {
    const response = await fetch(
      `${server.url}/api/subjects?question=${encodeURIComponent("https://github.com/other/app/pull/7")}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Pull request link must belong to github.com/acme/app" });
    expect(session.state.subject).toBeUndefined();
    const valid = await fetch(`${server.url}/api/subjects?question=%237`);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ type: "change", base: "origin/main", pr: 7 });
  } finally {
    server.close();
  }
});

test("the subject API validates submitted inputs, including target without source", async () => {
  const session = await Session.create(repo);
  const server = await startServer({ session, onRequest: async () => {}, uiDir: repo, port: 0 });
  try {
    for (const query of ["target=main", "source=+&target=main&question=Why%3F"]) {
      const response = await fetch(`${server.url}/api/subjects?${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Target requires a source" });
    }
    const invalid = await fetch(`${server.url}/api/subjects?source=no-such-branch`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Source branch "no-such-branch" not found' });
    const blank = await fetch(`${server.url}/api/subjects?source=&target=&question=`);
    expect(await blank.json()).toEqual({ type: "path", path: "." });
    const valid = await fetch(`${server.url}/api/subjects?source=feature&target=main&question=Why%3F`);
    expect(valid.status).toBe(200);
    const subject = (await valid.json()) as Subject;
    expect(subject).toEqual({
      type: "change",
      base: "refs/heads/main",
      head: "refs/heads/feature",
      question: "Why?",
    });
    expect(session.state.subject).toBeUndefined();
    const handle = requestHandler(session, new JobRunner(session, new FakeHarness()), []);
    await handle({ type: "subject.choose", subject });
    expect(session.state.subject).toEqual({ subject, label: "feature vs main" });
  } finally {
    server.close();
  }
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

test("preparing a pull request preserves its question", async () => {
  expect(
    await preparePullRequest(repo, { type: "change", base: "main", pr: 7, question: "Why retries?" }),
  ).toMatchObject({
    head: prCommit,
    question: "Why retries?",
  });
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

test.each(["refs/heads/feature", "refs/remotes/origin/main"])(
  "qualified branch %s finds its pull request",
  async (head) => {
    expect(await pullRequestFor(repo, { type: "change", base: "main", head })).toMatchObject({
      title: head === "refs/heads/feature" ? "feature" : "main",
    });
  },
);

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

  // An explicit local target stays local, even when only behind its upstream.
  const explicit = { type: "change" as const, base: "refs/heads/main", head: "refs/heads/mine", question: "Why?" };
  expect(await prepareChange(stale, explicit)).toEqual(explicit);
  expect(git(stale, "rev-parse", "refs/heads/main")).toBe(old);
  expect(git(stale, "rev-parse", "origin/main")).toBe(old);

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
