import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Checkouts, fetchPullRequest } from "./checkout";
import { GitHub } from "./github";

let dir: string;
let origin: string;
let repo: string;
let base: string;
let head: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cg-checkout-test-"));
  origin = join(dir, "origin");
  repo = join(dir, "repo");
  mkdirSync(origin);
  mkdirSync(repo);
  git(origin, "init", "-q", "-b", "main");
  git(origin, "config", "user.email", "test@example.com");
  git(origin, "config", "user.name", "Test");
  git(origin, "config", "commit.gpgsign", "false");
  git(origin, "config", "core.hooksPath", join(dir, "no-hooks"));
  git(origin, "config", "uploadpack.allowFilter", "true");
  git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  mkdirSync(join(origin, "src"));
  mkdirSync(join(origin, "unrelated"));
  writeFileSync(join(origin, "README.md"), "root context\n");
  writeFileSync(join(origin, "src", "file.ts"), "base\n");
  writeFileSync(join(origin, "unrelated", "large.ts"), "not materialized\n");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "base");
  base = git(origin, "rev-parse", "HEAD");
  git(origin, "checkout", "-qb", "feature");
  // More history than the initial shallow fetch, so merge-base requires deepening.
  for (let i = 0; i < 40; i++) git(origin, "commit", "--allow-empty", "-qm", `commit ${i}`);
  writeFileSync(join(origin, "src", "file.ts"), "head\n");
  writeFileSync(join(origin, "src", "a[1].ts"), "literal path\n");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "change");
  head = git(origin, "rev-parse", "HEAD");
  git(repo, "init", "-q");
  git(repo, "remote", "add", "origin", `file://${origin}`);
  git(repo, "config", "remote.origin.promisor", "true");
  git(repo, "config", "remote.origin.partialclonefilter", "blob:none");
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("deepens to the real merge-base and checks out only changed paths and root context", async () => {
  expect(await fetchPullRequest(repo, { baseRefOid: base, headRefOid: head })).toEqual({ base, head });
  expect(git(repo, "rev-parse", "HEAD")).toBe(head);
  expect(readFileSync(join(repo, "src", "file.ts"), "utf8")).toBe("head\n");
  expect(readFileSync(join(repo, "src", "a[1].ts"), "utf8")).toBe("literal path\n");
  expect(existsSync(join(repo, "README.md"))).toBe(true);
  expect(existsSync(join(repo, "unrelated", "large.ts"))).toBe(false);
  expect(git(repo, "show", "HEAD:unrelated/large.ts")).toBe("not materialized");
  expect(git(repo, "status", "--porcelain")).toBe("");
}, 20_000);

test("refresh materializes the new head without leaving tracked changes", async () => {
  writeFileSync(join(origin, "src", "file.ts"), "updated\n");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "update");
  head = git(origin, "rev-parse", "HEAD");
  await fetchPullRequest(repo, { baseRefOid: base, headRefOid: head });
  expect(readFileSync(join(repo, "src", "file.ts"), "utf8")).toBe("updated\n");
  expect(git(repo, "status", "--porcelain")).toBe("");
}, 20_000);

test("cleanup never removes an unowned local repository", async () => {
  const checkouts = new Checkouts(new GitHub(dir));
  await checkouts.release(origin, false);
  expect(existsSync(join(origin, ".git"))).toBe(true);
});
