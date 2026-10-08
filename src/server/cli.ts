import { stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { modules } from "../modules/index.js";
import { moduleInfo } from "../modules/types.js";
import type { Subject } from "../shared/protocol.js";
import { Chat } from "./chat.js";
import { showStatus } from "./terminal.js";
import { repoRoot, revParse } from "./git.js";
import { createHarness, DEFAULT_HARNESS, harnesses } from "./harness/index.js";
import { JobRunner } from "./jobs.js";
import { followUps, labelQuestions, requestHandler } from "./requests.js";
import { watchPullRequest } from "./remote.js";
import { resolveGuide } from "./resolve.js";
import { startServer } from "./server.js";
import { Session } from "./session.js";
import { loadSettings, projectSettingsPath, userSettingsPath } from "./settings.js";
import { DEFAULT_VIEW } from "../shared/settings.js";

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
  code-guide [dir]                   Start a session in the repo containing dir (default: .)
  code-guide check <guide.json>…     Validate guides against the spec. Exits 1 on errors.

Subject (optional; otherwise pick one in the browser)
  --change <base>[...<head>]   A change: from the merge-base of base to head (default: the working tree)
  --path <path>                A directory, package or service
  --question <text>            A question about the code

Options
  --harness <name>      Agent harness: ${Object.keys(harnesses).join(", ")} (default ${DEFAULT_HARNESS})
  --model <model>       Model for jobs and chat
  --review-model <m>    Model for reviews (default: --model)
  --port <n>            Port to serve on (default 4646, next free port if taken)
  --open, --no-open     Open the browser, or don't (default: open)
  -v, --version         Show the version and the commit it was built from
  -h, --help            Show this help

Settings
  ${userSettingsPath()}, overridden key by key by <repo>/.code-guide/settings.json, overridden by flags:
  { "harness", "model", "reviewModel", "port", "open", "theme": "light" | "dark" | "system",
    "modules": ["guide", "chat"] (open when a session starts, left to right) }

Sessions are kept in <repo>/.code-guide/sessions/. Guide spec: ${join(pkgRoot, "docs/spec.md")}`;

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
  subject?: Subject;
};

function parseSubject(flag: string, value: string | undefined): Subject {
  if (!value) throw new Error(`${flag} needs a value`);
  if (flag === "--path") return { type: "path", path: value };
  if (flag === "--question") return { type: "question", question: value };
  const [base, head] = value.split("...");
  return { type: "change", base, ...(head && { head }) };
}

async function serve(dir: string | undefined, flags: Flags) {
  const target = resolve(dir ?? ".");
  if (!(await stat(target).catch(() => undefined))) {
    console.error(`No such directory: ${target}`);
    return 1;
  }
  const root = await repoRoot(target);
  if (!root) {
    console.error(`${target} isn't inside a git repository. Run code-guide from inside one.`);
    return 1;
  }
  let settings;
  try {
    settings = await loadSettings(root);
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
    port: flags.port ?? settings.port ?? 4646,
    open: flags.open ?? settings.open ?? true,
  };
  // A ref that doesn't resolve would fail every submission; say so now instead.
  if (flags.subject?.type === "change")
    for (const ref of [flags.subject.base, flags.subject.head])
      if (ref && !(await revParse(root, ref))) {
        console.error(`--change: unknown ref "${ref}"`);
        return 1;
      }
  const harness = createHarness(opts.harness, opts.model);
  const ok = await harness.check();
  if (!ok.ok) {
    console.error(`Can't use ${harness.name}: ${ok.reason}`);
    return 1;
  }
  const reviewer = opts.reviewModel ? createHarness(opts.harness, opts.reviewModel) : harness;

  const session = await Session.create(root);
  session.append("harness.status", { harness: harness.name, model: harness.model, state: "ready" });
  const runner = new JobRunner(session, (kind) => (kind === "review" ? reviewer : harness));
  followUps(session, runner, modules);
  labelQuestions(session, runner);
  watchPullRequest(session);
  const chat = new Chat(session, harness);
  const onRequest = requestHandler(session, runner, modules, chat);
  if (flags.subject) await onRequest({ type: "subject.choose", subject: flags.subject });

  const { url } = await startServer({
    session,
    onRequest,
    modules: modules.map(moduleInfo),
    uiDir: join(here, "ui"),
    port: opts.port,
    view: { modules: settings.modules ?? DEFAULT_VIEW.modules, theme: settings.theme ?? DEFAULT_VIEW.theme },
  });
  console.log(`Running version ${VERSION}`);
  console.log(`Code Guide for ${relative(process.cwd(), root) || "."} at ${url}`);
  console.log(`Session ${session.id}. Press Ctrl+C to stop.\n`);
  if (opts.open) await open(url).catch(() => console.log("(Couldn't open a browser; visit the URL above.)"));
  // After the browser opens, so a failure to open prints above the live block, not into it.
  showStatus(session, modules.map(moduleInfo), {
    harness: harness.name,
    model: harness.model,
    status: () => chat.status,
    onStatus: (fn) => chat.onStatus(fn),
  });
  return new Promise<number>(() => {});
}

async function main(argv: string[]) {
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
    else if (a === "--change" || a === "--path" || a === "--question") flags.subject = parseSubject(a, argv[++i]);
    else args.push(a);
  }
  if (args[0] === "check") return check(args.slice(1));
  return serve(args[0], flags);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  },
);
