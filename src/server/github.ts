import type { GitHubStatus, Page, PullRequestChoice, Repository } from "../shared/launcher.js";
import { PAGE_SIZE, parsePullRequestLink, repositorySchema } from "../shared/launcher.js";
import { run } from "./run.js";

/** How long authentication and the account's organizations are kept before GitHub is asked again. */
export const CACHE_MS = 5 * 60_000;

/** GitHub's search returns at most this many results, however many match. */
const SEARCH_LIMIT = 1000;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Names without case-insensitive duplicates, in order, marked recent when `recent` has them. */
function unique(recent: string[], names: string[]): Repository[] {
  return [...new Map(names.map((name) => [name.toLowerCase(), name])).values()].map((name) => ({
    name,
    recent: recent.some((r) => same(r, name)),
  }));
}

/** A PR as GitHub's REST and search APIs return it. Search puts `merged_at` under `pull_request`. */
type ApiPullRequest = {
  number: number;
  title: string;
  state: "open" | "closed";
  draft?: boolean;
  user: { login: string } | null;
  merged_at?: string | null;
  pull_request?: { merged_at: string | null };
};

const choice = (pr: ApiPullRequest): PullRequestChoice => ({
  number: pr.number,
  title: pr.title,
  state: (pr.merged_at ?? pr.pull_request?.merged_at) ? "MERGED" : pr.state === "open" ? "OPEN" : "CLOSED",
  author: pr.user && { login: pr.user.login },
  isDraft: !!pr.draft,
});

/** Whether there's a page after `page` of a search that found `total`. */
const morePages = (page: number, total: number) => page * PAGE_SIZE < Math.min(total, SEARCH_LIMIT);

export type PullRequestCommits = { headRefOid: string; baseRefOid: string };

/** All GitHub metadata uses gh's active account, without changing the user's authentication. */
export class GitHub {
  constructor(
    readonly cwd: string,
    readonly host = process.env.GH_HOST || "github.com",
  ) {
    if (!/^[\w.-]+$/.test(host)) throw new Error("Invalid GitHub hostname");
  }

  /** Aborting `signal` kills gh, e.g. when the browser no longer wants the answer. */
  private async json<T>(args: string[], signal?: AbortSignal): Promise<T> {
    return JSON.parse(
      await run("gh", args, { cwd: this.cwd, env: { GH_HOST: this.host, GH_PROMPT_DISABLED: "1" }, signal }),
    );
  }

  /** A GET of GitHub's REST API, with `params` encoded by gh. */
  private api<T>(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
    const fields = Object.entries(params).flatMap(([k, v]) => [typeof v === "number" ? "-F" : "-f", `${k}=${v}`]);
    return this.json<T>(["api", "-X", "GET", path, ...fields], signal);
  }

  private auth?: { at: number; result: Promise<GitHubStatus> };

  /** Asks GitHub, and keeps the answer for `requireAuth`. The account may have changed, so its organizations go. */
  status(): Promise<GitHubStatus> {
    this.orgs = undefined;
    const result = (async (): Promise<GitHubStatus> => {
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
    })();
    this.auth = { at: Date.now(), result };
    return result;
  }

  /** A recent successful status is reused; a failed one is checked again. */
  async requireAuth(): Promise<GitHubStatus & { ok: true }> {
    const kept = this.auth && Date.now() - this.auth.at < CACHE_MS ? await this.auth.result : undefined;
    const status = kept?.ok ? kept : await this.status();
    if (!status.ok) throw new Error(status.error);
    return status;
  }

  private orgs?: { at: number; result: Promise<string[]> };

  /** The account and its organizations, kept like authentication. */
  private async owners(): Promise<string[]> {
    const { login } = await this.requireAuth();
    if (!this.orgs || Date.now() - this.orgs.at >= CACHE_MS) {
      const result = this.json<{ login: string }[]>(["api", "user/orgs?per_page=100"]).then((o) =>
        o.map((o) => o.login),
      );
      this.orgs = { at: Date.now(), result };
      // A failure isn't kept: the next request tries again.
      result.catch(() => (this.orgs = undefined));
    }
    return [login, ...(await this.orgs.result)];
  }

  /**
   * One page of the repositories the account owns, collaborates on, or can see through its organizations, most
   * recently pushed first. The first page starts with `recent`, which later pages leave out.
   */
  async repositories(recent: string[], page = 1, signal?: AbortSignal): Promise<Page<Repository>> {
    await this.requireAuth();
    const found = await this.api<{ full_name: string }[]>(
      "user/repos",
      { affiliation: "owner,collaborator,organization_member", sort: "pushed", per_page: PAGE_SIZE, page },
      signal,
    );
    const names = found.map((r) => r.full_name).filter((name) => !recent.some((r) => same(r, name)));
    return { items: unique(recent, page === 1 ? [...recent, ...names] : names), hasMore: found.length === PAGE_SIZE };
  }

  /**
   * One page of GitHub's repository search: across the account and its organizations (`mine`), or all of GitHub.
   * It matches whole words, so the launcher also matches partial names against the repositories it has listed.
   */
  async searchRepositories(
    query: string,
    scope: "mine" | "all",
    page = 1,
    signal?: AbortSignal,
  ): Promise<Page<Repository>> {
    const owners = scope === "mine" ? await this.owners() : (await this.requireAuth(), []);
    const found = await this.api<{ total_count: number; items: { full_name: string }[] }>(
      "search/repositories",
      { q: [query.trim(), ...owners.map((o) => `user:${o}`)].join(" "), per_page: PAGE_SIZE, page },
      signal,
    );
    return {
      items: unique(
        [],
        found.items.map((r) => r.full_name),
      ),
      hasMore: morePages(page, found.total_count),
    };
  }

  /**
   * One page of a repository's PRs, newest first. A search that is a PR number (`12`, `#12`) or a link to one of
   * the repository's PRs finds just that PR, whatever the other filters say.
   */
  async pullRequests(
    repo: string,
    options: { search?: string; author?: string; state?: string; page?: number } = {},
    signal?: AbortSignal,
  ): Promise<Page<PullRequestChoice>> {
    await this.requireAuth();
    const name = repositorySchema.parse(repo);
    const state = options.state ?? "all";
    if (!["all", "open", "closed", "merged"].includes(state)) throw new Error("Invalid PR state");
    const search = options.search?.trim() ?? "";
    const link = parsePullRequestLink(search);
    const number =
      link && link.host === this.host.toLowerCase() && same(link.repo, name)
        ? link.number
        : Number(search.match(/^#?(\d+)$/)?.[1]);
    if (number > 0) return { items: await this.pullRequest(name, number, signal), hasMore: false };

    const author = (options.author ?? "me").trim();
    const terms = [`repo:${name}`, "is:pr"];
    if (state === "open") terms.push("is:open");
    if (state === "closed") terms.push("is:closed", "is:unmerged");
    if (state === "merged") terms.push("is:merged");
    if (author) terms.push(`author:${author === "me" ? "@me" : author}`);
    if (search) terms.push(search);
    const page = options.page ?? 1;
    const found = await this.api<{ total_count: number; items: ApiPullRequest[] }>(
      "search/issues",
      // With a search, GitHub's best matches come first.
      { q: terms.join(" "), per_page: PAGE_SIZE, page, ...(!search && { sort: "created", order: "desc" }) },
      signal,
    );
    return { items: found.items.map(choice), hasMore: morePages(page, found.total_count) };
  }

  /** The PR with this number, or none when the repository has no such PR. */
  private async pullRequest(repo: string, number: number, signal?: AbortSignal): Promise<PullRequestChoice[]> {
    try {
      return [choice(await this.json<ApiPullRequest>(["api", `repos/${repo}/pulls/${number}`], signal))];
    } catch (e) {
      if (/HTTP 404/.test((e as Error).message)) return [];
      throw e;
    }
  }

  /**
   * Logins to suggest for the author filter: the repository's top contributors. Suggestions only, so a repository
   * GitHub can't list contributors for (an empty one) has none rather than an error.
   */
  async authors(repo: string, signal?: AbortSignal): Promise<string[]> {
    await this.requireAuth();
    const name = repositorySchema.parse(repo);
    try {
      const found = await this.json<{ login?: string }[]>(["api", `repos/${name}/contributors?per_page=100`], signal);
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
