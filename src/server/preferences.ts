import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { loadSettings, userSettingsPath } from "./settings.js";
import { repositorySchema, type HistoryEntry } from "../shared/launcher.js";

/** The most sessions history keeps. */
export const HISTORY_LIMIT = 100;

const historySchema = z.array(
  z.object({
    id: z.string(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    mode: z.enum(["pr", "local"]),
    label: z.string(),
    checkout: z.string(),
    kept: z.boolean().optional(),
  }),
);

/** Launcher-owned writes are serialized so settings and recency cannot lose concurrent updates. */
export class Preferences {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(readonly home = homedir()) {}

  private update<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writes.then(fn);
    this.writes = next.catch(() => {});
    return next;
  }

  private async save(path: string, data: unknown) {
    await mkdir(join(this.home, ".code-guide"), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    await rename(temp, path);
  }

  async keepClones(): Promise<boolean> {
    return (await loadSettings(undefined, this.home)).keepClones ?? false;
  }

  setKeepClones(keepClones: boolean): Promise<void> {
    return this.update(async () => {
      const settings = await loadSettings(undefined, this.home);
      await this.save(userSettingsPath(this.home), { ...settings, keepClones });
    });
  }

  async recent(host: string): Promise<string[]> {
    return (await this.recentRepositories())[host] ?? [];
  }

  private async recentRepositories(): Promise<Record<string, string[]>> {
    try {
      return z
        .record(z.string(), z.array(repositorySchema))
        .parse(JSON.parse(await readFile(join(this.home, ".code-guide", "repositories.json"), "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error(`Cannot read repository history: ${(e as Error).message}`);
    }
  }

  remember(host: string, repo: string): Promise<void> {
    return this.update(async () => {
      const name = repositorySchema.parse(repo);
      const recent = await this.recentRepositories();
      recent[host] = [name, ...(recent[host] ?? []).filter((r) => r.toLowerCase() !== name.toLowerCase())].slice(0, 20);
      await this.save(join(this.home, ".code-guide", "repositories.json"), recent);
    });
  }

  private get historyPath() {
    return join(this.home, ".code-guide", "history.json");
  }

  /** Past and running sessions, newest first. */
  async history(): Promise<HistoryEntry[]> {
    try {
      return historySchema.parse(JSON.parse(await readFile(this.historyPath, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(`Cannot read session history: ${(e as Error).message}`);
    }
  }

  /** Add a session that started, or update one by id. */
  recordSession(entry: HistoryEntry): Promise<void>;
  recordSession(id: string, patch: Partial<HistoryEntry>): Promise<void>;
  recordSession(entry: HistoryEntry | string, patch: Partial<HistoryEntry> = {}): Promise<void> {
    return this.update(async () => {
      const history = await this.history();
      const next =
        typeof entry === "string"
          ? history.map((h) => (h.id === entry ? { ...h, ...patch } : h))
          : [entry, ...history.filter((h) => h.id !== entry.id)];
      await this.save(this.historyPath, next.slice(0, HISTORY_LIMIT));
    });
  }
}
