import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { modules } from "../modules/index.js";
import { moduleInfo } from "../modules/types.js";
import { Chat } from "./chat.js";
import { reportStatus } from "./terminal.js";
import { LauncherConsole } from "./screen.js";
import { createHarness, DEFAULT_HARNESS, harnesses } from "./harness/index.js";
import { JobRunner } from "./jobs.js";
import { generateGlossary } from "./glossary.js";
import { followUps, labelQuestions, requestHandler } from "./requests.js";
import { watchPullRequest } from "./remote.js";
import { resolveGuide } from "./resolve.js";
import { startServer } from "./server.js";
import { Session } from "./session.js";
import { run } from "./run.js";
import type { Selection } from "../shared/launcher.js";
import { loadSettings, projectSettingsPath, userSettingsPath } from "./settings.js";
import { Preferences } from "./preferences.js";
import { DEFAULT_VIEW } from "../shared/settings.js";
import { startLauncher } from "./launcher.js";
import { refreshCheckout } from "./checkout.js";
import type { SessionStart } from "./session-process.js";
import type { Harness } from "./harness/types.js";

declare const __VERSION__: string | undefined;
declare const __COMMIT__: string | undefined;
/** Set by the build (tsup.config.ts); absent when the source runs directly, as in tests. */
const VERSION =
  typeof __VERSION__ === "string"
    ? `${__VERSION__}${typeof __COMMIT__ === "string" && __COMMIT__ ? `#${__COMMIT__}` : ""}`
    : "dev";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const HELP = `code-guide: understand code through a guide, a quiz, and questions

Usage
  code-guide [dir]                   Open the console and the browser to choose a subject; dir starts Local there
  code-guide check <guide.json>…     Validate guides against the spec. Exits 1 on errors.

Options
  --pr <number|link>    Start a session on this pull request (a number uses the repository in dir, or .)
  --harness <name>      Agent harness: ${Object.keys(harnesses).join(", ")} (default ${DEFAULT_HARNESS})
  --model <model>       Model for jobs and chat
  --review-model <m>    Model for reviews (default: --model)
  --port <n>            Port to serve on (default 4646, next free port if taken)
  --open, --no-open     Open the browser, or don't (default: open)
  -v, --version         Show the version and the commit it was built from
  -h, --help            Show this help

Settings
  ${userSettingsPath()}, overridden key by key by <repo>/.code-guide/settings.json (Local sessions only),
  overridden by flags:
  { "harness", "model", "reviewModel", "port", "open", "theme": "light" | "dark" | "system",
    "modules": ["guide", "chat"] (open when a session starts, left to right),
    "keepClones": false (retain temporary PR checkouts when true; editable in the console's settings) }

Sessions are kept in <repo>/.code-guide/sessions/; their history is in ~/.code-guide/history.json. Guide spec: ${join(pkgRoot, "docs/spec.md")}`;

async function check(files: string[]) {
  if (files.length === 0) {
    console.error("usage: code-guide check <guide.json>…");
    return 2;
  }
  let errors = 0;
  for (const f of files) {
    const { problems } = await resolveGuide(resolve(f));
    const e = problems.filter((p) => p.level === "error");
    const w = problems.filter((p) => p.level === "warning");
    errors += e.length;
    console.log(`${f}: ${e.length} error(s), ${w.length} warning(s)`);
    for (const p of [...e, ...w])
      console.log(`  ${p.level === "error" ? "error  " : "warning"} ${p.where}: ${p.message}`);
  }
  return errors ? 1 : 0;
}

type Flags = {
  port?: number;
  open?: boolean;
  harness?: string;
  model?: string;
  reviewModel?: string;
  /** A pull request, by number or link, started as soon as the launcher is up. */
  pr?: string;
};

/**
 * A session process: one session on the subject the launcher chose, in the repository it chose. Its console is
 * the launcher's; it reports there instead of writing to the terminal.
 */
async function serve(child: SessionStart) {
  const root = child.repo;
  const flags = { ...child.flags, subject: child.subject };
  let settings;
  try {
    settings = await loadSettings(child.managed ? undefined : root);
  } catch (e) {
    console.error(`Bad settings: ${(e as Error).message}`);
    return 1;
  }
  const unknown = settings.modules?.filter((name) => !modules.some((m) => m.name === name));
  if (unknown?.length) {
    console.error(
      `Bad settings: no module named ${unknown.map((n) => `"${n}"`).join(", ")} (in ${userSettingsPath()} or ${projectSettingsPath(root)}). ` +
        `Choose from: ${modules.map((m) => m.name).join(", ")}`,
    );
    return 1;
  }
  // Flags win over settings.
  const opts = {
    harness: flags.harness ?? settings.harness,
    model: flags.model ?? settings.model,
    reviewModel: flags.reviewModel ?? settings.reviewModel,
  };
  const makeHarness = (model?: string): Harness => {
    const harness = createHarness(opts.harness, model);
    if (!child.managed) return harness;
    return {
      name: harness.name,
      model: harness.model,
      check: () => harness.check(),
      start: (options) =>
        harness.start({
          ...options,
          instructions:
            options.instructions +
            "\n\nThis is a shallow, sparse PR checkout. The working tree contains changed files and root context only. Use git ls-files to discover other paths and git show HEAD:path to read them on demand. Missing working-tree files are not necessarily deleted. History is limited to the PR comparison.",
        }),
    };
  };
  const harness = makeHarness(opts.model);
  const ok = await harness.check();
  if (!ok.ok) {
    console.error(`Can't use ${harness.name}: ${ok.reason}`);
    return 1;
  }
  const reviewer = opts.reviewModel ? makeHarness(opts.reviewModel) : harness;

  const session = await Session.create(root);
  session.append("harness.status", { harness: harness.name, model: harness.model, state: "ready" });
  const runner = new JobRunner(session, (kind) => (kind === "review" ? reviewer : harness));
  const stopFollowUps = followUps(session, runner, modules);
  const stopLabels = labelQuestions(session, runner);
  generateGlossary(session, runner);
  const stopWatch = watchPullRequest(session);
  const chat = new Chat(session, harness);
  const onRequest = requestHandler(
    session,
    runner,
    modules,
    chat,
    child.managed
      ? async (repo, subject) =>
          subject.head ? subject : { ...subject, ...(await refreshCheckout(repo, subject.pr!)) }
      : undefined,
  );
  let stopping = false;
  let stopStatus: (() => void) | undefined;
  let closeServer: (() => void) | undefined;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    stopFollowUps();
    stopLabels();
    stopWatch();
    stopStatus?.();
    closeServer?.();
    await Promise.all([
      chat.stop(),
      ...session.state.jobOrder
        .filter((id) => ["queued", "running"].includes(session.state.jobs[id].status))
        .map((id) => runner.cancel(id)),
    ]);
    process.exit(0);
  };
  const shutdown = () => {
    void stop().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("disconnect", shutdown);
  await onRequest({ type: "subject.choose", subject: flags.subject });

  const { url, close } = await startServer({
    session,
    onRequest,
    modules: modules.map(moduleInfo),
    uiDir: join(here, "ui"),
    port: 0,
    launcherUrl: child.launcherUrl,
    onEnd: shutdown,
    view: { modules: settings.modules ?? DEFAULT_VIEW.modules, theme: settings.theme ?? DEFAULT_VIEW.theme },
  });
  closeServer = close;
  const agent = {
    harness: harness.name,
    model: harness.model,
    status: () => chat.status,
    onStatus: (fn: () => void) => chat.onStatus(fn),
  };
  stopStatus = reportStatus(session, modules.map(moduleInfo), agent, (report) => process.send?.(report));
  process.send?.({ url, session: session.id });
  return new Promise<number>(() => {});
}

async function launch(dir: string | undefined, flags: Flags) {
  const settings = await loadSettings();
  let selection: Selection | undefined;
  if (flags.pr) {
    const link = flags.pr.match(/^https:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)\/?(?:[?#].*)?$/);
    if (link && link[1].toLowerCase() !== (process.env.GH_HOST || "github.com").toLowerCase())
      throw new Error("The PR link must belong to GH_HOST (github.com by default)");
    const number = Number(link?.[3] ?? flags.pr.replace(/^#/, ""));
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error("--pr needs a PR number or link");
    const repo =
      link?.[2] ??
      JSON.parse(await run("gh", ["repo", "view", "--json", "nameWithOwner"], { cwd: resolve(dir ?? ".") }))
        .nameWithOwner;
    selection = { mode: "pr", repo, number };
  }
  // The console exists before the launcher, so the launcher can report to it from its first request.
  let launcher: Awaited<ReturnType<typeof startLauncher>> | undefined;
  let stopping = false;
  const browse = (url: string) => void open(url).catch(() => screen.log(`Couldn't open a browser; visit ${url}.`));
  const screen = new LauncherConsole(VERSION, {
    keepClones: () => (launcher?.preferences ?? new Preferences()).keepClones(),
    setKeepClones: (keep) => (launcher?.preferences ?? new Preferences()).setKeepClones(keep),
    history: async () => (launcher ? launcher.history() : []),
    openBrowser: () => launcher && browse(launcher.sessionUrl ?? launcher.url),
    endSession: async () => launcher?.end(),
    quit: () => stop(),
  });
  // Whatever ends the process, the terminal is left as it was found.
  process.once("exit", () => screen.stop());
  process.once("uncaughtException", (e) => {
    screen.stop();
    console.error(e);
    process.exit(1);
  });
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void (launcher?.close() ?? Promise.resolve()).then(
      () => {
        screen.stop();
        process.exit(0);
      },
      (e) => {
        screen.stop();
        console.error(e);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  screen.start();
  try {
    launcher = await startLauncher({
      cwd: process.cwd(),
      uiDir: join(here, "ui"),
      entry: fileURLToPath(import.meta.url),
      port: flags.port ?? settings.port ?? 4646,
      localPath: dir ? resolve(dir) : undefined,
      flags,
      events: {
        github: (status) => screen.setGitHub(status),
        session: (session) => screen.setSession(session),
        live: (lines) => screen.setLive(lines),
        log: (line) => screen.log(line),
      },
    });
    screen.setUrl(launcher.url);
    const browserUrl = selection ? await launcher.select(selection) : launcher.url;
    if (flags.open ?? settings.open ?? true) browse(browserUrl);
  } catch (e) {
    await launcher?.close();
    screen.stop();
    throw e;
  }
  return new Promise<number>(() => {});
}

async function main(argv: string[]) {
  if (argv[0] === "--session-process") {
    if (!process.send) throw new Error("Session processes must be started by Code Guide");
    const start = await new Promise<SessionStart>((resolve) =>
      process.once("message", (message) => resolve(message as SessionStart)),
    );
    return serve(start);
  }
  const args: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return (console.log(HELP), 0);
    else if (a === "-v" || a === "--version") return (console.log(VERSION), 0);
    else if (a === "--no-open") flags.open = false;
    else if (a === "--open") flags.open = true;
    else if (a === "--port") flags.port = Number(argv[++i]);
    else if (a === "--harness") flags.harness = argv[++i];
    else if (a === "--model") flags.model = argv[++i];
    else if (a === "--review-model") flags.reviewModel = argv[++i];
    else if (a === "--pr") {
      flags.pr = argv[++i];
      if (!flags.pr) throw new Error("--pr needs a value");
    } else if (a.startsWith("-")) throw new Error(`Unknown option ${a}. See code-guide --help.`);
    else args.push(a);
  }
  if (args[0] === "check") return check(args.slice(1));
  return launch(args[0], flags);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  },
);
