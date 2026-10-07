import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { settingsSchema, type Settings } from "../shared/settings.js";

export const userSettingsPath = (home = homedir()) => join(home, ".code-guide", "settings.json");
export const projectSettingsPath = (repo: string) => join(repo, ".code-guide", "settings.json");

/** One settings file; none at all is no settings. Anything unreadable or invalid throws, naming the file. */
async function readSettings(path: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`${path}: ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`${path}: not valid JSON (${(e as Error).message})`);
  }
  const parsed = settingsSchema.safeParse(json);
  if (!parsed.success)
    throw new Error(
      `${path}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).join("; ")}`,
    );
  return parsed.data;
}

/** The user's settings, overridden key by key by the repository's. */
export async function loadSettings(repo: string, home = homedir()): Promise<Settings> {
  const [user, project] = await Promise.all([
    readSettings(userSettingsPath(home)),
    readSettings(projectSettingsPath(repo)),
  ]);
  return { ...user, ...project };
}
