import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadSettings, projectSettingsPath, userSettingsPath } from "./settings";

let home: string;
let repo: string;
const write = (path: string, data: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cg-home-"));
  repo = mkdtempSync(join(tmpdir(), "cg-repo-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

test("no settings files means no settings", async () => {
  expect(await loadSettings(repo, home)).toEqual({});
});

test("the repository's settings override the user's, key by key", async () => {
  write(userSettingsPath(home), { model: "a", theme: "dark", modules: ["guide"] });
  write(projectSettingsPath(repo), { model: "b", modules: ["guide", "diff"] });
  expect(await loadSettings(repo, home)).toEqual({ model: "b", theme: "dark", modules: ["guide", "diff"] });
});

test("an invalid file is an error that names it", async () => {
  write(userSettingsPath(home), { theme: "sepia" });
  await expect(loadSettings(repo, home)).rejects.toThrow(/settings\.json: theme/);
  write(userSettingsPath(home), "{ nope");
  await expect(loadSettings(repo, home)).rejects.toThrow(/not valid JSON/);
  write(userSettingsPath(home), { colour: "red" });
  await expect(loadSettings(repo, home)).rejects.toThrow(/colour/);
});
