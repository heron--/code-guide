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
/** One page of a longer list. `hasMore` is true when the next page may have more. */
export type Page<T> = { items: T[]; hasMore: boolean };
/** How many repositories or PRs one page lists. */
export const PAGE_SIZE = 25;

/** The PR a link names, e.g. `https://github.com/acme/app/pull/7`, on whichever host the link is for. */
export function parsePullRequestLink(text: string): { host: string; repo: string; number: number } | undefined {
  const m = text.trim().match(/^https:\/\/([^/\s]+)\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#]\S*)?$/);
  const number = Number(m?.[3]);
  return m && Number.isSafeInteger(number) && number > 0 ? { host: m[1].toLowerCase(), repo: m[2], number } : undefined;
}
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
