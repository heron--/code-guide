import type { GitHubStatus, PullRequestChoice, Repository } from "../shared/launcher.js";
import { repositorySchema } from "../shared/launcher.js";
import { run } from "./run.js";

/** The most of the account's own repositories `repositories` lists. */
export const MINE_LIMIT = 1000;

/** Names without case-insensitive duplicates, in order, marked recent when `recent` has them. */
function unique(recent: string[], names: string[]): Repository[] {
  return [...new Map(names.map((name) => [name.toLowerCase(), name])).values()].map((name) => ({
    name,
    recent: recent.some((r) => r.toLowerCase() === name.toLowerCase()),
  }));
}

export type PullRequestCommits = { headRefOid: string; baseRefOid: string };

/** All GitHub metadata uses gh's active account, without changing the user's authentication. */
export class GitHub {
  constructor(
    readonly cwd: string,
    readonly host = process.env.GH_HOST || "github.com",
  ) {
    if (!/^[\w.-]+$/.test(host)) throw new Error("Invalid GitHub hostname");
  }

  private async json<T>(args: string[]): Promise<T> {
    return JSON.parse(await run("gh", args, { cwd: this.cwd, env: { GH_HOST: this.host, GH_PROMPT_DISABLED: "1" } }));
  }

  async status(): Promise<GitHubStatus> {
    try {
      const { login } = await this.json<{ login: string }>(["api", "user"]);
      if (!login) throw new Error("GitHub did not return an authenticated user");
      return { ok: true, login, host: this.host };
    } catch (e) {
      return {
        ok: false,
        error: `GitHub unavailable. Run gh auth login --hostname ${this.host}, then retry. ${(e as Error).message}`,
      };
    }
  }

  async requireAuth(): Promise<GitHubStatus & { ok: true }> {
    const status = await this.status();
    if (!status.ok) throw new Error(status.error);
    return status;
  }

  private mine?: { at: number; result: Promise<{ names: string[]; complete: boolean }> };

  /**
   * Repositories the account owns, collaborates on, or can see through its organizations, most recently pushed
   * first. Fetched once and kept for five minutes; `complete` is false when there were more than `MINE_LIMIT`.
   */
  private myRepositories(): Promise<{ names: string[]; complete: boolean }> {
    if (this.mine && Date.now() - this.mine.at < 5 * 60_000) return this.mine.result;
    const result = (async () => {
      const names: string[] = [];
      for (let page = 1; page <= MINE_LIMIT / 100; page++) {
        const found = await this.json<{ full_name: string }[]>([
          "api",
          `user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100&page=${page}`,
        ]);
        names.push(...found.map((r) => r.full_name));
        if (found.length < 100) return { names, complete: true };
      }
      return { names, complete: false };
    })();
    this.mine = { at: Date.now(), result };
    // A failure isn't kept: the next request tries again.
    result.catch(() => (this.mine = undefined));
    return result;
  }

  /** Recently accessed repositories first, then the account's own (see `myRepositories`). */
  async repositories(recent: string[]): Promise<{ repositories: Repository[]; complete: boolean }> {
    await this.requireAuth();
    const { names, complete } = await this.myRepositories();
    return { repositories: unique(recent, [...recent, ...names]), complete };
  }

  /**
   * GitHub's repository search: across the account and its organizations (`mine`), or all of GitHub. For names
   * `repositories` didn't return; it matches whole words, so partial names are best matched against that list.
   */
  async searchRepositories(query: string, scope: "mine" | "all"): Promise<Repository[]> {
    const { login } = await this.requireAuth();
    const owners =
      scope === "mine"
        ? [login, ...(await this.json<{ login: string }[]>(["api", "user/orgs?per_page=100"])).map((o) => o.login)]
        : [];
    const found = await this.json<{ fullName: string }[]>([
      "search",
      "repos",
      "--limit",
      "30",
      "--json",
      "fullName",
      ...owners.map((o) => `--owner=${o}`),
      "--",
      query.trim(),
    ]);
    return unique(
      [],
      found.map((r) => r.fullName),
    );
  }

  async pullRequests(
    repo: string,
    options: { search?: string; author?: string; state?: string } = {},
  ): Promise<PullRequestChoice[]> {
    await this.requireAuth();
    const state = options.state ?? "all";
    if (!["all", "open", "closed", "merged"].includes(state)) throw new Error("Invalid PR state");
    const args = [
      "pr",
      "list",
      "--repo",
      `${this.host}/${repositorySchema.parse(repo)}`,
      "--state",
      state,
      "--limit",
      "100",
      "--json",
      "number,title,state,author,isDraft",
    ];
    const author = options.author ?? "me";
    if (author.trim()) args.push(`--author=${author.trim() === "me" ? "@me" : author.trim()}`);
    if (options.search?.trim()) args.push(`--search=${options.search.trim()}`);
    return this.json(args);
  }

  /**
   * Logins to suggest for the author filter: the repository's top contributors. Suggestions only, so a repository
   * GitHub can't list contributors for (an empty one) has none rather than an error.
   */
  async authors(repo: string): Promise<string[]> {
    await this.requireAuth();
    const name = repositorySchema.parse(repo);
    try {
      const found = await this.json<{ login?: string }[]>(["api", `repos/${name}/contributors?per_page=100`]);
      return found.flatMap((c) => (c.login ? [c.login] : []));
    } catch {
      return [];
    }
  }

  async commits(repo: string, number: number): Promise<PullRequestCommits> {
    await this.requireAuth();
    const result = await this.json<PullRequestCommits>([
      "pr",
      "view",
      String(number),
      "--repo",
      `${this.host}/${repositorySchema.parse(repo)}`,
      "--json",
      "headRefOid,baseRefOid",
    ]);
    if (![result.baseRefOid, result.headRefOid].every((sha) => /^[a-f0-9]{40}$/.test(sha)))
      throw new Error("GitHub did not return valid PR commits");
    return result;
  }
}
