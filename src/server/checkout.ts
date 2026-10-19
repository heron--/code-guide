import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subject } from "../shared/protocol.js";
import { GitHub, type PullRequestCommits } from "./github.js";
import { run } from "./run.js";

const git = (cwd: string, args: string[]) =>
  run("git", args, {
    cwd,
    env: { GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
  });

/** Fetch only two tips and enough blob-filtered history to prove their merge-base. Never unshallow. */
export async function fetchPullRequest(
  repo: string,
  commits: PullRequestCommits,
): Promise<{ base: string; head: string }> {
  const { baseRefOid: base, headRefOid: head } = commits;
  const refs = [`+${base}:refs/code-guide/base`, `+${head}:refs/code-guide/head`];
  await git(repo, ["fetch", "--quiet", "--no-tags", "--filter=blob:none", "--depth=32", "origin", ...refs]);
  let common: string | undefined;
  for (let depth = 32; depth <= 4096; depth *= 2) {
    common = await git(repo, ["merge-base", base, head]).then(
      (s) => s.trim(),
      () => undefined,
    );
    if (common) break;
    if (depth < 4096)
      await git(repo, ["fetch", "--quiet", "--no-tags", "--filter=blob:none", `--deepen=${depth}`, "origin", ...refs]);
  }
  if (!common) throw new Error("No merge-base within 4096 commits. Use Local with an existing checkout for this PR.");

  // Keep root context and precisely the changed paths. Other code remains readable with git show.
  const files = (await git(repo, ["diff", "--name-only", "--no-renames", "-z", common, head]))
    .split("\0")
    .filter(Boolean);
  if (files.some((f) => /[\r\n]/.test(f))) throw new Error("PR paths containing newlines require a local checkout");
  const escape = (path: string) => path.replace(/[\\*?\[\]#! ]/g, "\\$&");
  await mkdir(join(repo, ".git", "info"), { recursive: true });
  await writeFile(
    join(repo, ".git", "info", "sparse-checkout"),
    ["/*", "!/*/", ...files.map((f) => `/${escape(f)}`), "!/.code-guide/", ""].join("\n"),
  );
  await git(repo, ["config", "core.sparseCheckout", "true"]);
  await git(repo, ["config", "core.sparseCheckoutCone", "false"]);
  await git(repo, ["checkout", "--quiet", "--detach", head]);
  await git(repo, ["read-tree", "-mu", "HEAD"]);
  return { base: common, head };
}

/** The only directories eligible for automatic removal are ones allocated by this object. */
export class Checkouts {
  private owned = new Set<string>();
  constructor(private github: GitHub) {}

  async create(name: string, number: number): Promise<{ repo: string; subject: Subject }> {
    const commits = await this.github.commits(name, number);
    const repo = await mkdtemp(join(tmpdir(), "code-guide-"));
    this.owned.add(repo);
    try {
      await git(repo, ["init", "--quiet"]);
      await git(repo, ["config", "core.hooksPath", join(repo, ".git", "no-hooks")]);
      await git(repo, ["remote", "add", "origin", `https://${this.github.host}/${name}.git`]);
      await git(repo, ["config", `credential.https://${this.github.host}.helper`, ""]);
      await git(repo, ["config", "--add", `credential.https://${this.github.host}.helper`, "!gh auth git-credential"]);
      await git(repo, ["config", "remote.origin.promisor", "true"]);
      await git(repo, ["config", "remote.origin.partialclonefilter", "blob:none"]);
      await git(repo, ["config", "codeguide.repository", name]);
      await git(repo, ["config", "codeguide.host", this.github.host]);
      const refs = await fetchPullRequest(repo, commits);
      return { repo, subject: { type: "change", ...refs, pr: number } };
    } catch (e) {
      await this.release(repo, false);
      throw e;
    }
  }

  async release(repo: string, keep: boolean): Promise<void> {
    if (!this.owned.has(repo)) return;
    if (!keep) await rm(repo, { recursive: true, force: true });
    this.owned.delete(repo);
  }
}

/** Managed checkouts must stay shallow, including when the reader updates to new PR commits. */
export async function refreshCheckout(repo: string, number: number): Promise<{ base: string; head: string }> {
  const name = (await git(repo, ["config", "--get", "codeguide.repository"])).trim();
  const host = (await git(repo, ["config", "--get", "codeguide.host"])).trim();
  return fetchPullRequest(repo, await new GitHub(repo, host).commits(name, number));
}
