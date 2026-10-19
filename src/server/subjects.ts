import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Subject } from "../shared/protocol.js";
import { shortRef, subjectInputsSchema } from "../shared/subjects.js";
import { revParse } from "./git.js";
import { run } from "./run.js";

const sh = async (cwd: string, cmd: string, args: string[]) => (await run(cmd, args, { cwd })).trim();
const quiet = <T>(p: Promise<T>) => p.catch(() => undefined);

/** The branch changes are compared against: origin's default, else main or master. */
export async function defaultBranch(repo: string): Promise<string | undefined> {
  const head = await quiet(sh(repo, "git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]));
  if (head) return head;
  for (const b of ["origin/main", "origin/master", "main", "master"]) if (await revParse(repo, b)) return b;
  return undefined;
}

/** The pull request a link or `#12` names. Links must belong to the repository `gh` uses for this session. */
export async function pullRequestNumber(repo: string, text: string): Promise<number | undefined> {
  const m = text.trim().match(/^(#|https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/)(\d+)(?:[/?#]\S*)?$/);
  if (!m) return undefined;
  if (m[1] !== "#") {
    const link = new URL(m[1]);
    const current = new URL(JSON.parse(await sh(repo, "gh", ["repo", "view", "--json", "url"])).url);
    if (
      link.host.toLowerCase() !== current.host.toLowerCase() ||
      link.pathname.toLowerCase() !== `${current.pathname}/pull/`.toLowerCase()
    )
      throw new Error(`Pull request link must belong to ${current.host}${current.pathname}`);
  }
  return Number(m[2]);
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
  if (!base || (await quiet(sh(repo, "git", ["check-ref-format", "--branch", name]))) === undefined) return undefined;
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
  const pr = await pullRequestNumber(repo, text);
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

/** Resolve a branch input without mistaking a tag or revision expression for a branch. */
async function inputBranch(repo: string, name: string, field: "Source" | "Target"): Promise<string> {
  const valid = await quiet(sh(repo, "git", ["check-ref-format", "--branch", name]));
  if (valid !== name) throw new Error(`${field} must be a branch or remote/branch`);
  const remotes = (await sh(repo, "git", ["remote"])).split("\n").filter(Boolean);
  const explicit = remotes.find((r) => name.startsWith(`${r}/`));
  if (!explicit && (await revParse(repo, `refs/heads/${name}`))) return `refs/heads/${name}`;

  const remote = explicit ?? (field === "Source" && remotes.includes("origin") ? "origin" : undefined);
  if (remote) {
    const branch = explicit ? name.slice(explicit.length + 1) : name;
    const ref = `refs/remotes/${remote}/${branch}`;
    if (await revParse(repo, ref)) return ref;
    const found = await quiet(
      run("git", ["ls-remote", "--exit-code", "--heads", remote, `refs/heads/${branch}`], {
        cwd: repo,
        env: { GIT_TERMINAL_PROMPT: "0" },
      }),
    );
    if (found) return ref;
  }
  throw new Error(`${field} branch "${name}" not found`);
}

/** Validate a submitted source, target and question; blank inputs explain the repository. */
export async function parseSubjectInputs(repo: string, input: unknown): Promise<Subject> {
  const parsed = subjectInputsSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const { source, target, question } = parsed.data;
  if (!source) return question ? parseInput(repo, question) : { type: "path", path: "." };

  const head = await inputBranch(repo, source, "Source");
  const base = target ? await inputBranch(repo, target, "Target") : await defaultBranch(repo);
  if (!base) throw new Error("No default branch found; specify a target");
  return { type: "change", base, head, ...(question && { question }) };
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
  return { ...subject, base, head: pr.headRefOid };
}

/** A pull request's description, as the Overview shows it. */
export type PullRequest = { number: number; title: string; url: string; body: string };

/**
 * The branch name `gh pr view` looks up for a head: `HEAD` is the branch it's on, and a remote-tracking branch
 * (`origin/feature`) drops its remote.
 */
async function branchName(repo: string, head: string): Promise<string | undefined> {
  if (head === "HEAD") return quiet(sh(repo, "git", ["branch", "--show-current"]));
  if (head.startsWith("refs/heads/")) return shortRef(head);
  head = shortRef(head);
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
 * - A qualified local branch (`refs/heads/main`) stays local, even when it has an upstream.
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
  const head = subject.head && !subject.head.startsWith("refs/heads/") ? shortRef(subject.head) : undefined;
  const headRemote = head && remotes.find((r) => head.startsWith(`${r}/`));
  if (headRemote) await fetch(headRemote, head!.slice(headRemote.length + 1));

  if (subject.base.startsWith("refs/heads/")) return subject;
  const base = shortRef(subject.base);
  const remote = remotes.find((r) => base.startsWith(`${r}/`));
  if (remote) {
    await fetch(remote, base.slice(remote.length + 1));
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
