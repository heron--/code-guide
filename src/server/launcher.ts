import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  selectionSchema,
  type DirectoryListing,
  type GitHubStatus,
  type HistoryItem,
  type LauncherState,
  type Selection,
} from "../shared/launcher.js";
import type { Settings } from "../shared/settings.js";
import { Checkouts } from "./checkout.js";
import { repoRoot } from "./git.js";
import { GitHub } from "./github.js";
import { listenLocal, readJson, sameOrigin } from "./http.js";
import { Preferences } from "./preferences.js";
import { send, serveStatic } from "./server.js";
import { SessionProcess } from "./session-process.js";
import { parseSubjectInputs } from "./subjects.js";

/** What the launcher tells its console: GitHub's status, the running session and its progress, and log lines. */
export type LauncherEvents = {
  github(status: GitHubStatus): void;
  session(session: { url: string; label: string } | undefined): void;
  live(lines: string[]): void;
  log(line: string): void;
};

const quietEvents: LauncherEvents = { github() {}, session() {}, live() {}, log() {} };

/** The most entries a directory listing returns. */
export const LISTING_LIMIT = 1000;

const expandHome = (path: string, cwd: string) =>
  path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(cwd, path);

/** One directory's entries for the file browser: directories first, and whether it is inside a git repository. */
export async function listDirectory(path: string): Promise<DirectoryListing> {
  const dir = resolve(path);
  const found = await readdir(dir, { withFileTypes: true });
  const entries = await Promise.all(
    found.map(async (e) => ({
      name: e.name,
      path: join(dir, e.name),
      // A symlink counts as what it points to.
      directory: e.isSymbolicLink()
        ? await stat(join(dir, e.name)).then(
            (s) => s.isDirectory(),
            () => false,
          )
        : e.isDirectory(),
    })),
  );
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  const parent = dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? undefined : parent,
    repository: await repoRoot(dir),
    entries: entries.slice(0, LISTING_LIMIT),
    truncated: entries.length > LISTING_LIMIT,
  };
}

export async function startLauncher(options: {
  cwd: string;
  uiDir: string;
  entry: string;
  port: number;
  localPath?: string;
  flags: Pick<Settings, "harness" | "model" | "reviewModel">;
  preferences?: Preferences;
  github?: GitHub;
  events?: LauncherEvents;
}) {
  const preferences = options.preferences ?? new Preferences();
  const github = options.github ?? new GitHub(options.cwd);
  const events = options.events ?? quietEvents;
  const checkouts = new Checkouts(github);
  let url = "";
  let active: SessionProcess | undefined;
  let sessionUrl: string | undefined;
  let starting: Promise<string> | undefined;
  let cleanup = Promise.resolve();
  let closing = false;
  const githubStatus = async () => {
    const status = await github.status();
    events.github(status);
    return status;
  };

  const start = async (choice: Selection) => {
    if (closing) throw new Error("Code Guide is stopping");
    await cleanup;
    if (active) throw new Error("End the current session before starting another");
    let repo: string | undefined;
    const managed = choice.mode === "pr";
    try {
      let subject;
      if (choice.mode === "pr") {
        events.log(`Preparing a shallow checkout of ${choice.repo}#${choice.number}…`);
        const prepared = await checkouts.create(choice.repo, choice.number);
        repo = prepared.repo;
        subject = prepared.subject;
      } else {
        repo = await repoRoot(expandHome(choice.path, options.cwd));
        if (!repo) throw new Error(`${choice.path} is not inside a git repository`);
        subject = await parseSubjectInputs(repo, choice.inputs);
      }
      if (closing) throw new Error("Code Guide is stopping");
      const child = new SessionProcess(
        options.entry,
        { repo, subject, managed, launcherUrl: url, flags: options.flags },
        { log: events.log, live: events.live },
      );
      active = child;
      let ready = false;
      cleanup = child.stopped
        .then(async () => {
          active = undefined;
          sessionUrl = undefined;
          events.session(undefined);
          // A session that stops cleanly exits with 0. After a crash, keep its checkout for a look at what happened.
          const crashed = ready && child.child.exitCode !== 0;
          if (crashed) events.log("The session process stopped unexpectedly.");
          // If settings become unreadable, retaining data is safer than deleting it.
          const keep = managed && ready && (crashed || (await preferences.keepClones().catch(() => true)));
          if (managed) {
            await checkouts.release(repo!, keep);
            events.log(keep ? `Kept PR checkout: ${repo}` : "Discarded the PR checkout.");
          }
          if (ready && child.id)
            await preferences
              .recordSession(child.id, { endedAt: new Date().toISOString(), ...(managed && { kept: keep }) })
              .catch((e) => events.log(`Couldn't save session history: ${(e as Error).message}`));
        })
        // Reported here rather than kept as a rejection, which would block every later session from starting.
        .catch((e) => events.log(`Checkout cleanup failed: ${(e as Error).message}`));
      sessionUrl = await child.ready;
      if (choice.mode === "pr") await preferences.remember(github.host, choice.repo);
      const label = choice.mode === "pr" ? `${choice.repo}#${choice.number}` : repo;
      if (child.id)
        await preferences
          .recordSession({
            id: child.id,
            startedAt: new Date().toISOString(),
            mode: choice.mode,
            label,
            checkout: repo,
          })
          .catch((e) => events.log(`Couldn't save session history: ${(e as Error).message}`));
      // It may have exited during the writes above, and its stopped handler has already run.
      if (active !== child) throw new Error("Session process stopped right after starting");
      ready = true;
      events.session({ url: sessionUrl, label });
      return sessionUrl;
    } catch (e) {
      if (active) await active.stop();
      await cleanup;
      if (managed && repo) await checkouts.release(repo, false);
      events.log(`Couldn't start the session: ${(e as Error).message}`);
      throw e;
    }
  };

  /** History as shown: the running session marked, and each checkout checked on disk. */
  const history = async (): Promise<HistoryItem[]> =>
    Promise.all(
      (await preferences.history()).map(async (h) => ({
        ...h,
        running: !!active && active.id === h.id,
        exists: await stat(h.checkout).then(
          (s) => s.isDirectory(),
          () => false,
        ),
      })),
    );

  const select = async (selection: Selection) => {
    if (starting || active || closing) throw new Error("A session is already starting or running");
    starting = start(selectionSchema.parse(selection));
    try {
      return await starting;
    } finally {
      starting = undefined;
    }
  };

  const server = createServer((req, res) => {
    const handle = async () => {
      if (!sameOrigin(req)) return send(res, 403, { error: "Forbidden" });
      const request = new URL(req.url ?? "/", "http://localhost");
      const path = request.pathname;
      const param = (name: string) => request.searchParams.get(name) ?? "";
      if (!path.startsWith("/api/")) return serveStatic(options.uiDir, path, res);
      if (req.method === "GET" && path === "/api/launcher") {
        const state: LauncherState & { sessionUrl?: string } = {
          mode: "launcher",
          github: await githubStatus(),
          localPath: options.localPath ?? options.cwd,
          keepClones: await preferences.keepClones(),
          sessionUrl,
        };
        return send(res, 200, state);
      }
      if (req.method === "GET" && path === "/api/history") return send(res, 200, await history());
      if (req.method === "GET" && path === "/api/directories")
        return send(res, 200, await listDirectory(expandHome(param("path") || options.cwd, options.cwd)));
      if (req.method === "GET" && path === "/api/repositories")
        return send(res, 200, await github.repositories(await preferences.recent(github.host)));
      if (req.method === "GET" && path === "/api/repositories/search")
        return send(res, 200, await github.searchRepositories(param("q"), param("scope") === "all" ? "all" : "mine"));
      if (req.method === "GET" && path === "/api/authors") return send(res, 200, await github.authors(param("repo")));
      if (req.method === "GET" && path === "/api/pull-requests") {
        const repo = param("repo");
        const prs = await github.pullRequests(repo, Object.fromEntries(request.searchParams));
        await preferences.remember(github.host, repo);
        return send(res, 200, prs);
      }
      if (req.method === "POST" && path === "/api/settings") {
        const { keepClones } = z
          .object({ keepClones: z.boolean() })
          .strict()
          .parse(await readJson(req));
        await preferences.setKeepClones(keepClones);
        return send(res, 200, { keepClones });
      }
      if (req.method === "POST" && path === "/api/start") {
        if (starting || active)
          return send(res, 409, { error: "A session is already starting or running", url: sessionUrl });
        const selection = selectionSchema.parse(await readJson(req));
        return send(res, 200, { url: await select(selection) });
      }
      return send(res, 404, { error: "Not found" });
    };
    void handle().catch((e) => send(res, 400, { error: (e as Error).message }));
  });
  url = await listenLocal(server, options.port);
  void githubStatus();
  return {
    url,
    preferences,
    select,
    history,
    /** The running session's URL, if one is running. */
    get sessionUrl() {
      return sessionUrl;
    },
    /** Stop the running session, and wait for its checkout to be kept or discarded. */
    end: async () => {
      await active?.stop();
      await cleanup;
    },
    close: async () => {
      closing = true;
      await starting?.catch(() => {});
      await active?.stop();
      await cleanup;
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
