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

/** The pull request a link (`https://github.com/acme/app/pull/12`, or a page of it like `/files`) or `#12` names. */
export function pullRequestNumber(text: string): number | undefined {
  const m = text.trim().match(/^(?:#|https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/)(\d+)(?:[/?#]\S*)?$/);
  return m ? Number(m[1]) : undefined;
}

/** A pull request as a subject. Its base is a placeholder until `preparePullRequest` asks GitHub for the real one. */
export async function pullRequestChange(repo: string, pr: number): Promise<Subject> {
  return { type: "change", base: (await defaultBranch(repo)) ?? "HEAD", pr };
}

/**
 * A branch as a subject: what it changes compared to the default branch. Found locally, then as origin has it,
 * then (when it's never been fetched) on origin itself; `prepareChange` fetches a remote branch before use.
 */
export async function branchChange(repo: string, name: string): Promise<Subject | undefined> {
  const base = await defaultBranch(repo);
  if (!base || !/^[\w./@{}~^-]+$/.test(name)) return undefined;
  if (await revParse(repo, name)) return { type: "change", base, head: name };
  if (await revParse(repo, `origin/${name}`)) return { type: "change", base, head: `origin/${name}` };
  // Never prompt for credentials: a branch that can't be checked quietly isn't one.
  const found = await quiet(
    run("git", ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${name}`], {
      cwd: repo,
      env: { GIT_TERMINAL_PROMPT: "0" },
    }),
  );
  return found ? { type: "change", base, head: `origin/${name}` } : undefined;
}

/**
 * Turn what the reader typed into a subject: a pull request link (or `#12`), a commit range ("a..b" or "a...b"),
 * a path that exists in the repository, a branch (compared to the default branch), or else a question.
 */
export async function parseInput(repo: string, input: string): Promise<Subject> {
  const text = input.trim();
  const pr = pullRequestNumber(text);
  if (pr) return pullRequestChange(repo, pr);
  const range = text.match(/^(\S+?)\.\.\.?(\S+)$/);
  if (range && (await revParse(repo, range[1])) && (await revParse(repo, range[2])))
    return { type: "change", base: range[1], head: range[2] };
  const abs = resolve(repo, text);
  if ((abs === repo || abs.startsWith(repo + sep)) && (await quiet(stat(abs))))
    return { type: "path", path: text.replace(/\/+$/, "") || "." };
  const branch = await branchChange(repo, text);
  if (branch) return branch;
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
 * The branch name `gh pr view` looks up for a head: `HEAD` is the branch it's on, and a remote-tracking branch
 * (`origin/feature`) drops its remote.
 */
async function branchName(repo: string, head: string): Promise<string | undefined> {
  if (head === "HEAD") return quiet(sh(repo, "git", ["branch", "--show-current"]));
  if (await revParse(repo, `refs/remotes/${head}`)) return head.slice(head.indexOf("/") + 1);
  return head;
}

/**
 * The pull request a change comes from: the one it names, else the open one for its head branch. Undefined when
 * there's none, or `gh` isn't installed or signed in.
 */
export async function pullRequestFor(repo: string, subject: Subject): Promise<PullRequest | undefined> {
  if (subject.type !== "change") return undefined;
  const which = subject.pr ? String(subject.pr) : subject.head && (await branchName(repo, subject.head));
  // A commit, or no head (the working tree), has no pull request of its own.
  if (!which || (!subject.pr && /^[0-9a-f]{7,40}$/.test(which))) return undefined;
  const out = await quiet(sh(repo, "gh", ["pr", "view", which, "--json", "number,title,url,body"]));
  return out ? (JSON.parse(out) as PullRequest) : undefined;
}

/**
 * Bring a change's base up to date before comparing against it. A stale local copy of the base moves the
 * merge-base back, and the change then includes everyone's commits to the base since the last fetch.
 *
 * - A remote-tracking base (`origin/main`) is fetched from its remote, and so is a remote-tracking head.
 * - A local branch (`main`) with an upstream fetches the upstream, and is compared as the upstream when it's
 *   only behind it. A local branch with commits of its own stays as it is.
 *
 * Best effort: offline, or with no remote, the local copy is used.
 */
export async function prepareChange(repo: string, subject: Subject & { type: "change" }): Promise<Subject> {
  const remotes = (await quiet(sh(repo, "git", ["remote"])))?.split("\n").filter(Boolean) ?? [];
  const fetch = (remote: string, branch: string) =>
    quiet(sh(repo, "git", ["fetch", "--quiet", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]));

  // A branch only the remote has (one typed by name) is fetched so it resolves, and so it's current.
  const headRemote = subject.head && remotes.find((r) => subject.head!.startsWith(`${r}/`));
  if (headRemote) await fetch(headRemote, subject.head!.slice(headRemote.length + 1));

  const remote = remotes.find((r) => subject.base.startsWith(`${r}/`));
  if (remote) {
    await fetch(remote, subject.base.slice(remote.length + 1));
    return subject;
  }

  const local = await quiet(sh(repo, "git", ["show-ref", "--verify", "--quiet", `refs/heads/${subject.base}`]));
  const upstream =
    local !== undefined && (await quiet(sh(repo, "git", ["rev-parse", "--abbrev-ref", `${subject.base}@{upstream}`])));
  const upRemote = upstream && remotes.find((r) => upstream.startsWith(`${r}/`));
  if (!upstream || !upRemote) return subject;
  await fetch(upRemote, upstream.slice(upRemote.length + 1));
  const behind = await quiet(sh(repo, "git", ["merge-base", "--is-ancestor", subject.base, upstream]));
  return behind !== undefined ? { ...subject, base: upstream } : subject;
}
