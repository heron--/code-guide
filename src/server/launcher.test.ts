import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startLauncher } from "./launcher";
import { GitHub } from "./github";
import { Preferences } from "./preferences";

let dir: string;
let repo: string;
let launcher: Awaited<ReturnType<typeof startLauncher>>;
let github: GitHub;
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cg-launcher-"));
  repo = join(dir, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(dir, "index.html"), "Code Guide launcher");
  writeFileSync(
    join(dir, "child.cjs"),
    `process.once('message', start => {
    require('node:fs').writeFileSync('started.json', JSON.stringify(start));
    process.send({url:'http://localhost:12345', session:'s-1'});
  });`,
  );
  github = new GitHub(dir);
  vi.spyOn(github, "status").mockResolvedValue({ ok: false, error: "Run gh auth login" });
  launcher = await startLauncher({
    cwd: dir,
    uiDir: dir,
    entry: join(dir, "child.cjs"),
    port: 0,
    flags: {},
    github,
    preferences: new Preferences(dir),
  });
});
afterEach(async () => {
  await launcher.close();
  rmSync(dir, { recursive: true, force: true });
});

test("opens outside git without a session or child, with auth errors and local defaults", async () => {
  expect(await (await fetch(launcher.url)).text()).toBe("Code Guide launcher");
  const state = await (await fetch(`${launcher.url}/api/launcher`)).json();
  expect(state).toMatchObject({ mode: "launcher", keepClones: false, localPath: dir, github: { ok: false } });
  expect(existsSync(join(dir, ".code-guide", "sessions"))).toBe(false);
  expect(existsSync(join(repo, "started.json"))).toBe(false);
});

test("local selection starts a separate process in the chosen repository without gh", async () => {
  const response = await fetch(`${launcher.url}/api/start`, json({ mode: "local", path: repo, inputs: {} }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: "http://localhost:12345" });
  expect(existsSync(join(repo, "started.json"))).toBe(true);
  const second = await fetch(`${launcher.url}/api/start`, json({ mode: "local", path: repo, inputs: {} }));
  expect(second.status).toBe(409);
});

test("invalid local selection returns an error without starting a process", async () => {
  const response = await fetch(`${launcher.url}/api/start`, json({ mode: "local", path: dir, inputs: {} }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("not inside a git repository");
  expect(existsSync(join(repo, "started.json"))).toBe(false);
});

test("settings persist and cross-origin writes are refused", async () => {
  const response = await fetch(`${launcher.url}/api/settings`, json({ keepClones: true }));
  expect(response.status).toBe(200);
  expect(await new Preferences(dir).keepClones()).toBe(true);
  const denied = await fetch(`${launcher.url}/api/settings`, {
    ...json({ keepClones: false }),
    headers: { "content-type": "application/json", origin: "https://example.com" },
  });
  expect(denied.status).toBe(403);
  expect(await new Preferences(dir).keepClones()).toBe(true);
});

test("lists directories first, with whether they are in a git repository, for the file browser", async () => {
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "a.txt"), "");
  const inRepo = await (await fetch(`${launcher.url}/api/directories?path=${encodeURIComponent(repo)}`)).json();
  expect(inRepo.repository).toBe(repo);
  expect(inRepo.parent).toBe(dir);
  expect(inRepo.entries.map((e: { name: string; directory: boolean }) => [e.name, e.directory])).toEqual([
    [".git", true],
    ["src", true],
    ["a.txt", false],
  ]);
  const outside = await (await fetch(`${launcher.url}/api/directories?path=${encodeURIComponent(dir)}`)).json();
  expect(outside.repository).toBeUndefined();
  const missing = await fetch(`${launcher.url}/api/directories?path=${encodeURIComponent(join(dir, "nope"))}`);
  expect(missing.status).toBe(400);
});

test("a session is recorded in history while it runs, and when it ends", async () => {
  await fetch(`${launcher.url}/api/start`, json({ mode: "local", path: repo, inputs: {} }));
  const running = await (await fetch(`${launcher.url}/api/history`)).json();
  expect(running).toEqual([
    expect.objectContaining({ id: "s-1", mode: "local", label: repo, checkout: repo, running: true, exists: true }),
  ]);
  expect(running[0].endedAt).toBeUndefined();
  await launcher.end();
  const [ended] = await (await fetch(`${launcher.url}/api/history`)).json();
  expect(ended).toMatchObject({ id: "s-1", running: false, exists: true });
  expect(ended.endedAt).toEqual(expect.any(String));
  expect(ended.kept).toBeUndefined();
});
