// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Launcher, launcherQueries, TYPING_PAUSE } from "./Launcher";
import type { LauncherState } from "../../shared/launcher";

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const initial: LauncherState = {
  mode: "launcher",
  github: { ok: true, login: "reader", host: "github.com" },
  localPath: "/work",
  keepClones: false,
};
const listing = {
  path: "/work",
  parent: "/",
  repository: "/work",
  entries: [
    { name: "src", path: "/work/src", directory: true },
    { name: "README.md", path: "/work/README.md", directory: false },
  ],
  truncated: false,
};
let searchResults: { name: string; recent: boolean }[] = [];
let history: unknown[] = [];
let mineMore = false;
let prsMore = false;
let queries: ReturnType<typeof launcherQueries>;
const render = (state = initial) =>
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queries },
        createElement(Launcher, { initial: state, refresh: vi.fn() }),
      ),
    ),
  );
/** Past a typing pause, and the requests it starts. */
const tick = async () => {
  await act(() => vi.advanceTimersByTimeAsync(TYPING_PAUSE));
  // Query results are delivered on a timer of their own.
  await act(() => vi.advanceTimersByTimeAsync(0));
};
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

beforeEach(async () => {
  searchResults = [{ name: "someone/pi-extensions", recent: false }];
  history = [];
  mineMore = false;
  prsMore = false;
  queries = launcherQueries();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.startsWith("/api/repositories/search")) return Response.json({ items: searchResults, hasMore: false });
    if (path.startsWith("/api/repositories"))
      return Response.json({
        items: path.includes("page=2")
          ? [{ name: "acme/second-page", recent: false }]
          : [
              { name: "acme/recent", recent: true },
              { name: "acme/other", recent: false },
              { name: "heron--/pi-extensions", recent: false },
            ],
        hasMore: mineMore && !path.includes("page=2"),
      });
    if (path.startsWith("/api/history")) return Response.json(history);
    if (path.startsWith("/api/authors")) return Response.json(["sam", "alex"]);
    if (path.startsWith("/api/directories")) return Response.json(listing);
    if (path.startsWith("/api/start")) return Response.json({ error: "Not started in tests" }, { status: 400 });
    return Response.json({
      items: [
        { number: 7, title: "Fix retries", state: "CLOSED", author: { login: "reader" }, isDraft: false },
        { number: 8, title: "Add tracing", state: "OPEN", author: { login: "kim" }, isDraft: true },
      ],
      hasMore: prsMore,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(() => root.unmount());
  queries.clear();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("PR-first, recent repository first, me and all states by default, including closed PRs", async () => {
  expect(button("Pull requests").getAttribute("aria-pressed")).toBe("true");
  expect(container.textContent).toContain("reader · authenticated");
  await tick();
  await tick();
  const request = fetchMock.mock.calls.find(([url]) => String(url).startsWith("/api/pull-requests"))!;
  expect(String(request[0])).toContain("repo=acme%2Frecent");
  expect(String(request[0])).toContain("author=me&state=all&page=1");
  expect(container.querySelector('[aria-label="Pull requests"]')?.textContent).toContain("closed · reader");
});

test("changing a PR filter clears stale choices and sends the new filter", async () => {
  await tick();
  await tick();
  const author = [...container.querySelectorAll("label")]
    .find((label) => label.textContent === "Author")!
    .querySelector("input")!;
  await type(author, "sam");
  expect(container.querySelector('[aria-label="Pull requests"]')).toBeNull();
  await tick();
  expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("author=sam");
});

test("authentication errors remain visible while Local is available without GitHub", async () => {
  queries.clear();
  fetchMock.mockClear();
  await render({ ...initial, github: { ok: false, error: "Run gh auth login" } });
  expect(container.textContent).toContain("Run gh auth login");
  await act(() => button("Local").click());
  await tick();
  expect(button("Start session").disabled).toBe(false);
  expect([...new Set(fetchMock.mock.calls.map(([url]) => String(url).split("?")[0]))].sort()).toEqual([
    "/api/directories",
    "/api/history",
  ]);
});

test("failed local startup keeps the form available for retry", async () => {
  await act(() => button("Local").click());
  await tick();
  fetchMock.mockResolvedValueOnce(Response.json({ error: "No repository" }, { status: 400 }));
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("No repository");
  expect(container.querySelector("fieldset")!.disabled).toBe(false);
});

const posted = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url) === "/api/start")
    .map(([, init]) => JSON.parse(String(init!.body)));

test("clicking a PR selects it; Start session starts the selected PR", async () => {
  await tick();
  await tick();
  const list = container.querySelector('[aria-label="Pull requests"]')!;
  expect(list.className).toContain("overflow-auto");
  expect(button("Start session").disabled).toBe(true);
  const pr = [...list.querySelectorAll("button")].find((b) => b.textContent?.includes("#8"))!;
  await act(() => pr.click());
  expect(pr.getAttribute("aria-pressed")).toBe("true");
  expect(posted()).toEqual([]);
  await act(async () => button("Start session").click());
  expect(posted()).toEqual([{ mode: "pr", repo: "acme/recent", number: 8 }]);
});

test("typing a PR filter clears the selection at once, before the new PRs arrive", async () => {
  await tick();
  await tick();
  const list = container.querySelector('[aria-label="Pull requests"]')!;
  await act(() => [...list.querySelectorAll("button")].find((b) => b.textContent?.includes("#8"))!.click());
  expect(button("Start session").disabled).toBe(false);
  const search = [...container.querySelectorAll("label")]
    .find((label) => label.textContent?.startsWith("Search PRs"))!
    .querySelector("input")!;
  await type(search, "tracing");
  expect(button("Start session").disabled).toBe(true);
});

test("the author filter suggests me, the repository's contributors, and listed PR authors", async () => {
  await tick();
  await tick();
  const options = [...container.querySelectorAll("#pr-authors option")].map((o) => o.getAttribute("value"));
  expect(options).toEqual(["me", "sam", "alex", "reader", "kim"]);
});

test("the file browser opens directories only, and starts a session in the directory shown", async () => {
  await act(() => button("Local").click());
  await tick();
  const files = container.querySelector('[aria-label="Files"]')!;
  expect([...files.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["../", "src/"]);
  const file = [...files.querySelectorAll("span")].find((s) => s.textContent === "README.md")!;
  expect(file.getAttribute("aria-disabled")).toBe("true");
  await act(() => [...files.querySelectorAll("button")].find((b) => b.textContent === "src/")!.click());
  await tick();
  expect(String(fetchMock.mock.calls.at(-1)![0])).toBe("/api/directories?path=%2Fwork%2Fsrc");
  await act(async () => button("Start session").click());
  expect(posted()).toEqual([{ mode: "local", path: "/work/src", inputs: { source: "", target: "", question: "" } }]);
});

test("Start session is unavailable outside a git repository", async () => {
  listing.repository = undefined as unknown as string;
  try {
    await act(() => button("Local").click());
    await tick();
    expect(container.textContent).toContain("Not in a git repository");
    expect(button("Start session").disabled).toBe(true);
  } finally {
    listing.repository = "/work";
  }
});

const repositoryNames = () =>
  [...container.querySelectorAll('[aria-label="Repositories"] button')].map((b) => b.textContent);
const repositorySearch = () => container.querySelector<HTMLInputElement>('[aria-label="Repository search"]')!;
const fetched = (prefix: string) => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(prefix));

test("your repositories match partial names at once; GitHub's search of yours follows when typing pauses", async () => {
  await tick();
  await type(repositorySearch(), "pi-e");
  await type(repositorySearch(), "pi-ext");
  expect(repositoryNames()).toEqual(["heron--/pi-extensions"]);
  expect(fetched("/api/repositories/search")).toEqual([]);
  await tick();
  expect(fetched("/api/repositories/search").map(([url]) => String(url))).toEqual([
    "/api/repositories/search?q=pi-ext&scope=mine&page=1",
  ]);
  expect(repositoryNames()).toEqual(["heron--/pi-extensions", "someone/pi-extensions"]);
});

test("your repositories are fetched a page at a time, and a page seen before isn't fetched again", async () => {
  mineMore = true;
  queries.clear();
  fetchMock.mockClear();
  await render({ ...initial });
  await tick();
  const pages = () => fetched("/api/repositories?").map(([url]) => String(url));
  expect(pages()).toEqual(["/api/repositories?page=1"]);
  expect(button("Previous").disabled).toBe(true);
  await act(() => button("Next").click());
  await tick();
  expect(repositoryNames()).toEqual(["acme/second-page"]);
  expect(container.textContent).toContain("Page 2");
  await act(() => button("Previous").click());
  await tick();
  expect(repositoryNames()).toContain("acme/other");
  expect(pages()).toEqual(["/api/repositories?page=1", "/api/repositories?page=2"]);
});

test("typing cancels the request for what was typed before", async () => {
  await tick();
  await tick();
  const search = [...container.querySelectorAll("label")]
    .find((label) => label.textContent?.startsWith("Search PRs"))!
    .querySelector("input")!;
  let first: AbortSignal | undefined;
  fetchMock.mockImplementationOnce((_url, init) => {
    first = init!.signal!;
    return new Promise(() => {});
  });
  await type(search, "retry");
  await tick();
  expect(first?.aborted).toBe(false);
  await type(search, "retries");
  await tick();
  expect(first?.aborted).toBe(true);
  expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("search=retries");
});

test("PRs page through their filters' results, starting over when a filter changes", async () => {
  prsMore = true;
  queries.clear();
  await render({ ...initial });
  await tick();
  await tick();
  const prPages = container.querySelector('[aria-label="PR pages"]')!;
  await act(() => [...prPages.querySelectorAll("button")].find((b) => b.textContent === "Next")!.click());
  await tick();
  expect(String(fetched("/api/pull-requests").at(-1)![0])).toContain("page=2");
  await act(() => (container.querySelector("select") as HTMLSelectElement).focus());
  await act(() => {
    const select = container.querySelector("select")!;
    select.value = "open";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await tick();
  expect(String(fetched("/api/pull-requests").at(-1)![0])).toContain("state=open&page=1");
});

test("a pasted PR link starts that PR", async () => {
  await tick();
  await type(repositorySearch(), "https://github.com/acme/app/pull/42");
  await act(async () => button("Start session on acme/app#42").click());
  expect(posted()).toEqual([{ mode: "pr", repo: "acme/app", number: 42 }]);
  expect(fetched("/api/repositories/search")).toEqual([]);
});

test("a PR link for another host isn't offered", async () => {
  await tick();
  await type(repositorySearch(), "https://ghe.example.com/acme/app/pull/42");
  expect(button("Start session on acme/app#42")).toBeUndefined();
});

test("with Only my repositories off, GitHub-wide results follow your own matches", async () => {
  await tick();
  const toggle = [...container.querySelectorAll("label")]
    .find((l) => l.textContent?.startsWith("Only my repositories"))!
    .querySelector("input")!;
  expect(toggle.checked).toBe(true);
  await act(() => toggle.click());
  await type(repositorySearch(), "pi-extensions");
  expect(container.textContent).toContain("Searching GitHub…");
  await tick();
  expect(String(fetched("/api/repositories/search")[0][0])).toBe(
    "/api/repositories/search?q=pi-extensions&scope=all&page=1",
  );
  expect(repositoryNames()).toEqual(["heron--/pi-extensions", "someone/pi-extensions"]);
  expect(container.textContent).not.toContain("Searching GitHub…");
});

test("loading your repositories shows its progress", async () => {
  expect(container.textContent).toContain("Loading your repositories…");
  await tick();
  expect(container.textContent).not.toContain("Loading your repositories…");
});

test("session history shows whether each PR checkout was kept and is still there", async () => {
  history = [
    {
      id: "a",
      startedAt: "2026-10-15T09:30:00Z",
      endedAt: "2026-10-15T10:00:00Z",
      mode: "pr",
      label: "acme/app#7",
      checkout: "/tmp/cg-1",
      kept: true,
      running: false,
      exists: true,
    },
    {
      id: "b",
      startedAt: "2026-10-15T08:00:00Z",
      endedAt: "2026-10-15T08:30:00Z",
      mode: "pr",
      label: "acme/app#6",
      checkout: "/tmp/cg-0",
      kept: true,
      running: false,
      exists: false,
    },
  ];
  await render({ ...initial });
  await tick();
  const items = [...container.querySelectorAll('[aria-label="Session history"] li')].map((li) => li.textContent);
  expect(items[0]).toContain("Checkout kept · still there");
  expect(items[0]).toContain("/tmp/cg-1");
  expect(items[1]).toContain("Checkout kept · since removed");
  expect(items[1]).not.toContain("/tmp/cg-0");
});
