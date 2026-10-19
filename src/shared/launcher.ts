import { z } from "zod";
import { subjectInputsSchema } from "./subjects.js";

export const repositorySchema = z
  .string()
  .trim()
  .regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/repository");
export const selectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("pr"), repo: repositorySchema, number: z.number().int().positive() }).strict(),
  z.object({ mode: z.literal("local"), path: z.string().trim().min(1), inputs: subjectInputsSchema }).strict(),
]);
export type Selection = z.infer<typeof selectionSchema>;
export type GitHubStatus = { ok: true; login: string; host: string } | { ok: false; error: string };
export type Repository = { name: string; recent: boolean };
export type PullRequestChoice = {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  author: { login: string } | null;
  isDraft: boolean;
};
/** One directory in the Local file browser. Only directories can be opened; files are listed for orientation. */
export type DirectoryListing = {
  path: string;
  parent?: string;
  /** The root of the git repository the directory is in, if it is in one. */
  repository?: string;
  entries: { name: string; path: string; directory: boolean }[];
  /** More entries exist than were returned. */
  truncated: boolean;
};
/** One session in `~/.code-guide/history.json`, newest first. */
export type HistoryEntry = {
  /** The session's id, which names its folder in `.code-guide/sessions/` of `checkout`. */
  id: string;
  startedAt: string;
  /** Absent when the session never ended cleanly, e.g. the launcher was killed. */
  endedAt?: string;
  mode: "pr" | "local";
  /** `owner/repo#number`, or the local repository's path. */
  label: string;
  /** The directory the session ran in: its temporary PR checkout, or the local repository. */
  checkout: string;
  /** For a PR session that ended: whether its checkout was kept. */
  kept?: boolean;
};
/** A history entry as shown: whether it's running, and whether its checkout is still on disk. */
export type HistoryItem = HistoryEntry & { running: boolean; exists: boolean };
export type LauncherState = {
  mode: "launcher";
  github: GitHubStatus;
  localPath: string;
  keepClones: boolean;
};
