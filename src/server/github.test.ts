import { beforeEach, expect, test, vi } from "vitest";
import { GitHub } from "./github";
import { run } from "./run";

vi.mock("./run", () => ({ run: vi.fn() }));
const command = vi.mocked(run);
const github = new GitHub("/tmp", "github.com");
beforeEach(() => {
  command.mockReset();
});
const authenticated = () => command.mockResolvedValueOnce('{"login":"reader"}');

test("reports the authenticated gh account and actionable authentication failures", async () => {
  authenticated();
  expect(await github.status()).toEqual({ ok: true, login: "reader", host: "github.com" });
  command.mockRejectedValueOnce(new Error("gh not found"));
  expect(await github.status()).toMatchObject({ ok: false, error: expect.stringContaining("gh auth login") });
});

test("PRs default to me and all states, without relying on the current directory's remote", async () => {
  authenticated();
  command.mockResolvedValueOnce("[]");
  expect(await github.pullRequests("acme/app")).toEqual([]);
  expect(command.mock.calls[1][1]).toEqual([
    "pr",
    "list",
    "--repo",
    "github.com/acme/app",
    "--state",
    "all",
    "--limit",
    "100",
    "--json",
    "number,title,state,author,isDraft",
    "--author=@me",
  ]);
});

test("search, author and state filters are separate arguments, and an empty author means anyone", async () => {
  authenticated();
  command.mockResolvedValueOnce("[]");
  await github.pullRequests("acme/app", { author: "", state: "closed", search: "retry fix" });
  const args = command.mock.calls[1][1];
  expect(args).toContain("--search=retry fix");
  expect(args).toContain("closed");
  expect(args.some((arg) => arg.startsWith("--author"))).toBe(false);
});

test("authentication errors are not empty PR results", async () => {
  command.mockRejectedValue(new Error("not authenticated"));
  await expect(github.pullRequests("acme/app")).rejects.toThrow("gh auth login");
  expect(command).toHaveBeenCalledTimes(1);
});

test("recent repositories precede the account's own, including its organizations', with no duplicates", async () => {
  const github = new GitHub("/tmp", "github.com");
  authenticated();
  command.mockResolvedValueOnce('[{"full_name":"acme/new"},{"full_name":"acme/recent"}]');
  expect(await github.repositories(["acme/recent", "acme/older"])).toEqual({
    repositories: [
      { name: "acme/recent", recent: true },
      { name: "acme/older", recent: true },
      { name: "acme/new", recent: false },
    ],
    complete: true,
  });
  expect(command.mock.calls[1][1][1]).toBe(
    "user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100&page=1",
  );
  // The list is kept: a second request only checks authentication.
  authenticated();
  await github.repositories([]);
  expect(command).toHaveBeenCalledTimes(3);
});

test("the account's repositories are paged, and marked incomplete past the limit", async () => {
  const github = new GitHub("/tmp", "github.com");
  const page = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ full_name: `acme/r${i}` })));
  authenticated();
  for (let i = 0; i < 10; i++) command.mockResolvedValueOnce(page.replaceAll("acme/r", `acme/p${i}-`));
  const { repositories, complete } = await github.repositories([]);
  expect(repositories).toHaveLength(1000);
  expect(complete).toBe(false);
});

test("searching your repositories is limited to you and your organizations; all of GitHub isn't", async () => {
  authenticated();
  command.mockResolvedValueOnce('[{"login":"acme"},{"login":"heron"}]');
  command.mockResolvedValueOnce('[{"fullName":"acme/pi-extensions"}]');
  expect(await github.searchRepositories(" pi-extensions ", "mine")).toEqual([
    { name: "acme/pi-extensions", recent: false },
  ]);
  expect(command.mock.calls[2][1]).toEqual([
    "search",
    "repos",
    "--limit",
    "30",
    "--json",
    "fullName",
    "--owner=reader",
    "--owner=acme",
    "--owner=heron",
    "--",
    "pi-extensions",
  ]);
  authenticated();
  command.mockResolvedValueOnce("[]");
  await github.searchRepositories("pi-extensions", "all");
  expect(command.mock.calls[4][1].some((a) => a.startsWith("--owner"))).toBe(false);
});

test("rejects malformed repository names and invalid states", async () => {
  authenticated();
  await expect(github.pullRequests("--bad")).rejects.toThrow("owner/repository");
  authenticated();
  await expect(github.pullRequests("acme/app", { state: "bad" })).rejects.toThrow("Invalid PR state");
});

test("suggests contributors as authors, and none when GitHub can't list them", async () => {
  authenticated();
  command.mockResolvedValueOnce('[{"login":"sam"},{"login":"alex"},{}]');
  expect(await github.authors("acme/app")).toEqual(["sam", "alex"]);
  expect(command.mock.calls[1][1]).toEqual(["api", "repos/acme/app/contributors?per_page=100"]);
  authenticated();
  command.mockResolvedValueOnce("");
  expect(await github.authors("acme/empty")).toEqual([]);
});
