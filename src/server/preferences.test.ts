import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Preferences } from "./preferences";
import { loadSettings, userSettingsPath } from "./settings";

let home: string;
let preferences: Preferences;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cg-preferences-"));
  preferences = new Preferences(home);
});
afterEach(() => rm(home, { recursive: true, force: true }));

test("defaults to discard and saves retention without losing user settings", async () => {
  expect(await preferences.keepClones()).toBe(false);
  await mkdir(join(home, ".code-guide"));
  await writeFile(userSettingsPath(home), JSON.stringify({ theme: "dark", model: "chosen" }));
  await preferences.setKeepClones(true);
  expect(await loadSettings(undefined, home)).toEqual({ theme: "dark", model: "chosen", keepClones: true });
  expect(await new Preferences(home).keepClones()).toBe(true);
  await preferences.setKeepClones(false);
  expect(JSON.parse(await readFile(userSettingsPath(home), "utf8")).keepClones).toBe(false);
});

test("concurrent recency writes are ordered, deduplicated and host-specific", async () => {
  await Promise.all([preferences.remember("github.com", "acme/one"), preferences.remember("github.com", "acme/two")]);
  await preferences.remember("github.com", "ACME/ONE");
  await preferences.remember("git.example.com", "acme/enterprise");
  expect(await new Preferences(home).recent("github.com")).toEqual(["ACME/ONE", "acme/two"]);
  expect(await preferences.recent("git.example.com")).toEqual(["acme/enterprise"]);
});

test("invalid existing settings cannot be overwritten by the editor", async () => {
  await mkdir(join(home, ".code-guide"));
  await writeFile(userSettingsPath(home), '{"theme":"bad"}');
  await expect(preferences.setKeepClones(true)).rejects.toThrow("theme");
  expect(await readFile(userSettingsPath(home), "utf8")).toBe('{"theme":"bad"}');
});

test("session history is newest first, updated by id, and kept across launches", async () => {
  const start = { startedAt: "2026-10-15T09:00:00Z", mode: "pr" as const, checkout: "/tmp/cg-1" };
  await preferences.recordSession({ id: "a", label: "acme/app#7", ...start });
  await preferences.recordSession({ id: "b", label: "acme/app#8", ...start });
  await preferences.recordSession("a", { endedAt: "2026-10-15T10:00:00Z", kept: true });
  const history = await new Preferences(home).history();
  expect(history.map((h) => h.id)).toEqual(["b", "a"]);
  expect(history[1]).toMatchObject({ label: "acme/app#7", endedAt: "2026-10-15T10:00:00Z", kept: true });
  expect(history[0].endedAt).toBeUndefined();
});
