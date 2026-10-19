import { beforeEach, expect, test, vi } from "vitest";
import { PAGE_SIZE } from "../shared/launcher";
import { CACHE_MS, GitHub } from "./github";
import { run } from "./run";

vi.mock("./run", () => ({ run: vi.fn() }));
const command = vi.mocked(run);
let github: GitHub;
beforeEach(() => {
  command.mockReset();
  github = new GitHub("/tmp", "github.com");
});
const authenticated = () => command.mockResolvedValueOnce('{"login":"reader"}');
const args = (call: number) => command.mock.calls[call][1];
/** The `q` a search call sent. */
const q = (call: number) => args(call).find((a) => a.startsWith("q="));
const searchResult = (items: unknown[], total = items.length) => JSON.stringify({ total_count: total, items });

test("reports the authenticated gh account and actionable authentication failures", async () => {
  authenticated();
  expect(await github.status()).toEqual({ ok: true, login: "reader", host: "github.com" });
  command.mockRejectedValueOnce(new Error("gh not found"));
  expect(await github.status()).toMatchObject({ ok: false, error: expect.stringContaining("gh auth login") });
});

test("authentication is checked once for a while, and again after a failure", async () => {
  authenticated();
  command.mockResolvedValue("[]");
  await github.authors("acme/app");
  await github.authors("acme/app");
  expect(command.mock.calls.filter(([, a]) => a[1] === "user")).toHaveLength(1);

  command.mockReset();
  command.mockRejectedValueOnce(new Error("not authenticated"));
  await github.status();
  authenticated();
  command.mockResolvedValue("[]");
  await github.authors("acme/app");
  expect(args(1)).toEqual(["api", "user"]);
});

test("authentication is checked again once the kept answer is old", async () => {
  vi.useFakeTimers();
  try {
    authenticated();
    command.mockResolvedValueOnce("[]");
    await github.authors("acme/app");
    vi.advanceTimersByTime(CACHE_MS);
    authenticated();
    command.mockResolvedValueOnce("[]");
    await github.authors("acme/app");
    expect(args(2)).toEqual(["api", "user"]);
  } finally {
    vi.useRealTimers();
  }
});

test("PRs default to me and all states, newest first, a page at a time, in the named repository", async () => {
  authenticated();
  command.mockResolvedValueOnce(searchResult([], 0));
  expect(await github.pullRequests("acme/app")).toEqual({ items: [], hasMore: false });
  expect(args(1)).toEqual([
    "api",
    "-X",
    "GET",
    "search/issues",
    "-f",
    "q=repo:acme/app is:pr author:@me",
    "-F",
    `per_page=${PAGE_SIZE}`,
    "-F",
    "page=1",
    "-f",
    "sort=created",
    "-f",
    "order=desc",
  ]);
});

test("search, author, state and page filters reach GitHub's search, and an empty author means anyone", async () => {
  authenticated();
  command.mockResolvedValueOnce(searchResult([], 0));
  await github.pullRequests("acme/app", { author: "", state: "closed", search: "retry fix", page: 3 });
  expect(q(1)).toBe("q=repo:acme/app is:pr is:closed is:unmerged retry fix");
  expect(args(1)).toContain("page=3");
  // A search is ordered by GitHub's best matches.
  expect(args(1)).not.toContain("sort=created");
  command.mockResolvedValueOnce(searchResult([], 0));
  await github.pullRequests("acme/app", { author: "sam", state: "merged" });
  expect(q(2)).toBe("q=repo:acme/app is:pr is:merged author:sam");
});

test("PR results read as open, closed or merged, with their author and draft state, and say if there's more", async () => {
  authenticated();
  command.mockResolvedValueOnce(
    searchResult(
      [
        {
          number: 9,
          title: "Open",
          state: "open",
          draft: true,
          user: { login: "kim" },
          pull_request: { merged_at: null },
        },
        {
          number: 8,
          title: "Merged",
          state: "closed",
          user: null,
          pull_request: { merged_at: "2026-10-01T00:00:00Z" },
        },
        { number: 7, title: "Closed", state: "closed", user: { login: "sam" }, pull_request: { merged_at: null } },
      ],
      PAGE_SIZE + 1,
    ),
  );
  expect(await github.pullRequests("acme/app")).toEqual({
    items: [
      { number: 9, title: "Open", state: "OPEN", author: { login: "kim" }, isDraft: true },
      { number: 8, title: "Merged", state: "MERGED", author: null, isDraft: false },
      { number: 7, title: "Closed", state: "CLOSED", author: { login: "sam" }, isDraft: false },
    ],
    hasMore: true,
  });
});

test("a PR number or a link to one of the repository's PRs finds that PR, whatever the filters", async () => {
  const pr = '{"number":12,"title":"Retry","state":"closed","merged_at":"2026-10-01T00:00:00Z","user":{"login":"sam"}}';
  for (const search of ["12", "#12", "https://github.com/Acme/App/pull/12/files"]) {
    command.mockReset();
    github = new GitHub("/tmp", "github.com");
    authenticated();
    command.mockResolvedValueOnce(pr);
    expect(await github.pullRequests("acme/app", { search, author: "kim", state: "open" })).toEqual({
      items: [{ number: 12, title: "Retry", state: "MERGED", author: { login: "sam" }, isDraft: false }],
      hasMore: false,
    });
    expect(command.mock.calls.at(-1)![1]).toEqual(["api", "repos/acme/app/pulls/12"]);
  }
  command.mockRejectedValueOnce(new Error("gh: Not Found (HTTP 404)"));
  expect(await github.pullRequests("acme/app", { search: "404" })).toEqual({ items: [], hasMore: false });
});

test("authentication errors are not empty PR results", async () => {
  command.mockRejectedValue(new Error("not authenticated"));
  await expect(github.pullRequests("acme/app")).rejects.toThrow("gh auth login");
  expect(command).toHaveBeenCalledTimes(1);
});

test("the first page of your repositories starts with recent ones, which later pages leave out", async () => {
  authenticated();
  command.mockResolvedValueOnce('[{"full_name":"acme/new"},{"full_name":"acme/recent"}]');
  expect(await github.repositories(["acme/recent", "acme/older"])).toEqual({
    items: [
      { name: "acme/recent", recent: true },
      { name: "acme/older", recent: true },
      { name: "acme/new", recent: false },
    ],
    hasMore: false,
  });
  expect(args(1)).toEqual([
    "api",
    "-X",
    "GET",
    "user/repos",
    "-f",
    "affiliation=owner,collaborator,organization_member",
    "-f",
    "sort=pushed",
    "-F",
    `per_page=${PAGE_SIZE}`,
    "-F",
    "page=1",
  ]);
  const full = JSON.stringify(Array.from({ length: PAGE_SIZE }, (_, i) => ({ full_name: `acme/r${i}` })));
  command.mockResolvedValueOnce(full.replace("acme/r0", "acme/recent"));
  const second = await github.repositories(["acme/recent"], 2);
  expect(second.items).toHaveLength(PAGE_SIZE - 1);
  expect(second.hasMore).toBe(true);
  expect(args(2)).toContain("page=2");
});

test("searching your repositories is limited to you and your organizations, which are kept; all of GitHub isn't", async () => {
  authenticated();
  command.mockResolvedValueOnce('[{"login":"acme"},{"login":"heron"}]');
  command.mockResolvedValueOnce(searchResult([{ full_name: "acme/pi-extensions" }], 2 * PAGE_SIZE));
  expect(await github.searchRepositories(" pi-extensions ", "mine")).toEqual({
    items: [{ name: "acme/pi-extensions", recent: false }],
    hasMore: true,
  });
  expect(args(2)).toEqual([
    "api",
    "-X",
    "GET",
    "search/repositories",
    "-f",
    "q=pi-extensions user:reader user:acme user:heron",
    "-F",
    `per_page=${PAGE_SIZE}`,
    "-F",
    "page=1",
  ]);
  command.mockResolvedValueOnce(searchResult([], 2 * PAGE_SIZE));
  expect((await github.searchRepositories("pi-extensions", "mine", 2)).hasMore).toBe(false);
  expect(command).toHaveBeenCalledTimes(4);
  command.mockResolvedValueOnce(searchResult([]));
  await github.searchRepositories("pi-extensions", "all");
  expect(q(4)).toBe("q=pi-extensions");
});

test("a cancelled request's signal reaches gh", async () => {
  authenticated();
  command.mockResolvedValueOnce(searchResult([]));
  const signal = new AbortController().signal;
  await github.pullRequests("acme/app", {}, signal);
  expect(command.mock.calls[1][2].signal).toBe(signal);
});

test("rejects malformed repository names and invalid states", async () => {
  authenticated();
  await expect(github.pullRequests("--bad")).rejects.toThrow("owner/repository");
  await expect(github.pullRequests("acme/app", { state: "bad" })).rejects.toThrow("Invalid PR state");
});

test("suggests contributors as authors, and none when GitHub can't list them", async () => {
  authenticated();
  command.mockResolvedValueOnce('[{"login":"sam"},{"login":"alex"},{}]');
  expect(await github.authors("acme/app")).toEqual(["sam", "alex"]);
  expect(args(1)).toEqual(["api", "repos/acme/app/contributors?per_page=100"]);
  command.mockResolvedValueOnce("");
  expect(await github.authors("acme/empty")).toEqual([]);
});
