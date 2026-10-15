// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Launcher } from "./Launcher";
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
let mineComplete = true;
const render = (state = initial) =>
  act(() => root.render(createElement(Launcher, { initial: state, refresh: vi.fn() })));
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

beforeEach(async () => {
  searchResults = [{ name: "someone/pi-extensions", recent: false }];
  history = [];
  mineComplete = true;
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.startsWith("/api/repositories/search")) return Response.json(searchResults);
    if (path.startsWith("/api/repositories"))
      return Response.json({
        repositories: [
          { name: "acme/recent", recent: true },
          { name: "acme/other", recent: false },
          { name: "heron--/pi-extensions", recent: false },
        ],
        complete: mineComplete,
      });
    if (path.startsWith("/api/history")) return Response.json(history);
    if (path.startsWith("/api/authors")) return Response.json(["sam", "alex"]);
    if (path.startsWith("/api/directories")) return Response.json(listing);
    if (path.startsWith("/api/start")) return Response.json({ error: "Not started in tests" }, { status: 400 });
    return Response.json([
      { number: 7, title: "Fix retries", state: "CLOSED", author: { login: "reader" }, isDraft: false },
      { number: 8, title: "Add tracing", state: "OPEN", author: { login: "kim" }, isDraft: true },
    ]);
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(() => root.unmount());
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
  expect(String(request[0])).toContain("author=me&state=all");
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
  await render({ ...initial, github: { ok: false, error: "Run gh auth login" } });
  expect(container.textContent).toContain("Run gh auth login");
  await act(() => button("Local").click());
  await tick();
  expect(button("Start session").disabled).toBe(false);
  expect(fetchMock.mock.calls.map(([url]) => String(url).split("?")[0]).sort()).toEqual([
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

test("your repositories match partial names at once, without searching GitHub", async () => {
  await tick();
  await type(repositorySearch(), "pi-ext");
  expect(repositoryNames()).toEqual(["heron--/pi-extensions"]);
  await tick();
  expect(fetched("/api/repositories/search")).toEqual([]);
  expect(fetched("/api/repositories")).toHaveLength(1);
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
  expect(String(fetched("/api/repositories/search")[0][0])).toBe("/api/repositories/search?q=pi-extensions&scope=all");
  expect(repositoryNames()).toEqual(["heron--/pi-extensions", "someone/pi-extensions"]);
  expect(container.textContent).not.toContain("Searching GitHub…");
});

test("loading your repositories shows its progress", async () => {
  expect(container.textContent).toContain("Loading your repositories…");
  await tick();
  expect(container.textContent).not.toContain("Loading your repositories…");
});

test("when your repositories didn't all fit, a search covers yours and your organizations'", async () => {
  mineComplete = false;
  await render({ ...initial });
  await tick();
  await type(repositorySearch(), "pi-extensions");
  await tick();
  expect(String(fetched("/api/repositories/search").at(-1)![0])).toContain("scope=mine");
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
