// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SubjectPicker } from "./SubjectPicker";

const channel = vi.hoisted(() => ({ send: vi.fn(), snapshot: { error: undefined as string | undefined } }));
vi.mock("@/lib/session", () => ({
  sessionChannel: () => channel,
  useSession: () => channel.snapshot,
}));

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}
const input = (name: string) => container.querySelector<HTMLInputElement>(`#subject-${name}`)!;
const start = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const render = () => act(async () => root.render(createElement(SubjectPicker)));
const submit = () =>
  act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const type = (name: string, value: string) =>
  act(async () => {
    const el = input(name);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  channel.snapshot.error = undefined;
  channel.send.mockReset().mockImplementation(() => {
    channel.snapshot.error = undefined;
    return true;
  });
  fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json([
        { subject: { type: "change", base: "HEAD" }, title: "Uncommitted changes", detail: "1 file changed" },
      ]),
    );
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test("all inputs are optional; target appears with source and clears when source is removed", async () => {
  expect(input("source").required).toBe(false);
  expect(input("question").required).toBe(false);
  expect(input("target")).toBeNull();
  expect(start().disabled).toBe(false);
  await type("source", "feature");
  expect(input("target").required).toBe(false);
  await type("target", "main");
  await type("source", " ");
  expect(input("target")).toBeNull();
  await type("source", "feature");
  expect(input("target").value).toBe("");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("an empty submission starts a repository subject", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ type: "path", path: "." }));
  await submit();
  const url = new URL(String(fetchMock.mock.calls[1][0]), "http://localhost");
  expect(Object.fromEntries(url.searchParams)).toEqual({ source: "", target: "", question: "" });
  expect(channel.send).toHaveBeenCalledWith({ type: "subject.choose", subject: { type: "path", path: "." } });
  expect(container.textContent).toContain("Starting…");
  expect(start().disabled).toBe(true);
});

test("checks on submission, then shows fetching progress and prevents duplicate choices", async () => {
  await type("source", "origin/feature");
  await type("target", "main");
  await type("question", "Why retries?");
  const pending = pendingResponse();
  fetchMock.mockReturnValueOnce(pending.promise);
  await submit();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Checking…");
  expect([...container.querySelectorAll("button,input")].every((el) => (el as HTMLInputElement).disabled)).toBe(true);
  expect(channel.send).not.toHaveBeenCalled();
  await submit();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const url = new URL(String(fetchMock.mock.calls[1][0]), "http://localhost");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    source: "origin/feature",
    target: "main",
    question: "Why retries?",
  });
  const subject = {
    type: "change",
    base: "refs/heads/main",
    head: "refs/remotes/origin/feature",
    question: "Why retries?",
  };
  await act(() => pending.resolve(Response.json(subject)));
  expect(channel.send).toHaveBeenCalledExactlyOnceWith({ type: "subject.choose", subject });
  expect(container.textContent).toContain("Fetching the latest commits…");
  expect(container.textContent).toContain("Change · main...origin/feature");
  expect(start().disabled).toBe(true);
});

test("validation errors keep the inputs and allow correction and retry", async () => {
  await type("source", "typo");
  fetchMock.mockResolvedValueOnce(Response.json({ error: 'Source branch "typo" not found' }, { status: 400 }));
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Source branch "typo" not found');
  expect(input("source").value).toBe("typo");
  expect(start().disabled).toBe(false);
  expect(channel.send).not.toHaveBeenCalled();
  await type("source", "feature");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  fetchMock.mockResolvedValueOnce(Response.json({ type: "change", base: "main", head: "feature" }));
  await submit();
  expect(channel.send).toHaveBeenCalledTimes(1);
});

test("a refused choice ends fetching progress and allows retry", async () => {
  await type("question", "#7");
  fetchMock.mockResolvedValue(Response.json({ type: "change", base: "main", pr: 7 }));
  await submit();
  expect(container.textContent).toContain("Fetching the latest commits…");
  channel.snapshot.error = "Could not fetch pull request";
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not fetch pull request");
  expect(start().disabled).toBe(false);
  expect(input("question").value).toBe("#7");
  // Each response body can only be read once.
  fetchMock.mockResolvedValueOnce(Response.json({ type: "change", base: "main", pr: 7 }));
  await submit();
  expect(channel.send).toHaveBeenCalledTimes(2);
  expect(start().disabled).toBe(true);
});

test("a failed validation request allows retry", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Network unavailable");
  expect(start().disabled).toBe(false);
  expect(channel.send).not.toHaveBeenCalled();
});

test("suggestions still start in one click, without validating typed inputs", async () => {
  await type("source", "typo");
  await act(() => container.querySelector<HTMLButtonElement>('ul[aria-label="Suggestions"] button')!.click());
  expect(channel.send).toHaveBeenCalledWith({ type: "subject.choose", subject: { type: "change", base: "HEAD" } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Fetching the latest commits…");
});

test("a closed channel does not leave the picker starting", async () => {
  channel.send.mockReturnValue(false);
  fetchMock.mockResolvedValueOnce(Response.json({ type: "path", path: "." }));
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Not connected");
  expect(start().disabled).toBe(false);
});

test("validation that finishes after the picker unmounts cannot choose a subject", async () => {
  const pending = pendingResponse();
  fetchMock.mockReturnValueOnce(pending.promise);
  await submit();
  const signal = fetchMock.mock.calls[1][1]?.signal;
  await act(() => root.render(null));
  expect(signal?.aborted).toBe(true);
  await act(() => pending.resolve(Response.json({ type: "path", path: "." })));
  expect(channel.send).not.toHaveBeenCalled();
});
