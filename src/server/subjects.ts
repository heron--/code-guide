import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Subject } from "../shared/protocol.js";
import { revParse } from "./git.js";
import { run } from "./run.js";

const sh = async (cwd: string, cmd: string, args: string[]) => (await run(cmd, args, { cwd })).trim();
const quiet = <T>(p: Promise<T>) => p.catch(() => undefined);

/** A subject the picker offers, with how to show it. */
export type Suggestion = { subject: Subject; title: string; detail: string };

/** The branch changes are compared against: origin's default, else main or master. */
export async function defaultBranch(repo: string): Promise<string | undefined> {
  const head = await quiet(sh(repo, "git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]));
  if (head) return head;
  for (const b of ["origin/main", "origin/master", "main", "master"]) if (await revParse(repo, b)) return b;
  return undefined;
}

/**
 * Subjects worth one click, each only when it applies: uncommitted work, the current branch when it's ahead
 * of the default branch, and open pull requests when the `gh` CLI is installed and signed in.
 */
export async function suggestions(repo: string): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  const base = await defaultBranch(repo);

  const dirty = await quiet(sh(repo, "git", ["status", "--porcelain", "--", ".", ":!.code-guide"]));
  if (dirty) {
    const files = dirty.split("\n").length;
    out.push({
      subject: { type: "change", base: "HEAD" },
      title: "Uncommitted changes",
      detail: `${files} file${files === 1 ? "" : "s"} changed in the working tree`,
    });
  }

  const branch = await quiet(sh(repo, "git", ["branch", "--show-current"]));
  // On the default branch itself, `origin/main..HEAD` still shows local commits not yet pushed.
  if (base && branch && base !== branch) {
    const ahead = Number(await quiet(sh(repo, "git", ["rev-list", "--count", `${base}..HEAD`])));
    if (ahead > 0)
      out.push({
        subject: { type: "change", base, head: branch },
        title: `${branch} vs ${base}`,
        detail: `${ahead} commit${ahead === 1 ? "" : "s"} ahead`,
      });
  }

  // Skipped silently when gh isn't installed, isn't signed in, or the repo isn't on GitHub.
  const prs = await quiet(
    sh(repo, "gh", ["pr", "list", "--state", "open", "--limit", "10", "--json", "number,title,author,baseRefName"]),
  );
  for (const pr of prs
    ? (JSON.parse(prs) as { number: number; title: string; author?: { login: string }; baseRefName: string }[])
    : [])
    out.push({
      subject: { type: "change", base: pr.baseRefName, pr: pr.number },
      title: `#${pr.number} ${pr.title}`,
      detail: `Pull request${pr.author ? ` by ${pr.author.login}` : ""} into ${pr.baseRefName}`,
    });
  return out;
}

/**
 * Turn what the reader typed into a subject: a commit range ("a..b" or "a...b"), a path that exists in the
 * repository, or else a question.
 */
export async function parseInput(repo: string, input: string): Promise<Subject> {
  const text = input.trim();
  const range = text.match(/^(\S+?)\.\.\.?(\S+)$/);
  if (range && (await revParse(repo, range[1])) && (await revParse(repo, range[2])))
    return { type: "change", base: range[1], head: range[2] };
  const abs = resolve(repo, text);
  if ((abs === repo || abs.startsWith(repo + sep)) && (await quiet(stat(abs))))
    return { type: "path", path: text.replace(/\/+$/, "") || "." };
  return { type: "question", question: text };
}

/**
 * Make a pull request's commits available locally, without creating branches: fetch its head commit and pin
 * the subject to it, comparing against the base as it is on origin.
 */
export async function preparePullRequest(repo: string, subject: Subject & { type: "change" }): Promise<Subject> {
  if (!subject.pr) return subject;
  const pr = JSON.parse(
    await sh(repo, "gh", ["pr", "view", String(subject.pr), "--json", "headRefOid,baseRefName"]),
  ) as { headRefOid: string; baseRefName: string };
  // Name the base's destination: a single-branch clone wouldn't otherwise keep it anywhere but FETCH_HEAD.
  const base = `origin/${pr.baseRefName}`;
  await sh(repo, "git", [
    "fetch",
    "--quiet",
    "origin",
    pr.headRefOid,
    `+refs/heads/${pr.baseRefName}:refs/remotes/${base}`,
  ]);
  return { type: "change", base, head: pr.headRefOid, pr: subject.pr };
}

/** A pull request's description, as the Overview shows it. */
export type PullRequest = { number: number; title: string; url: string; body: string };

/**
 * The pull request a change comes from: the one it names, else the open one for its head branch. Undefined when
 * there's none, or `gh` isn't installed or signed in.
 */
export async function pullRequestFor(repo: string, subject: Subject): Promise<PullRequest | undefined> {
  if (subject.type !== "change") return undefined;
  // `gh pr view` takes a branch, not a revision, so `HEAD` becomes the branch it's on.
  const which = subject.pr
    ? String(subject.pr)
    : subject.head === "HEAD"
      ? await quiet(sh(repo, "git", ["branch", "--show-current"]))
      : subject.head;
  // A commit, or no head (the working tree), has no pull request of its own.
  if (!which || (!subject.pr && /^[0-9a-f]{7,40}$/.test(which))) return undefined;
  const out = await quiet(sh(repo, "gh", ["pr", "view", which, "--json", "number,title,url,body"]));
  return out ? (JSON.parse(out) as PullRequest) : undefined;
}
