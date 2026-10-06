import { stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { repoRoot } from "./git.js";
import { AGENTS, installSkill, isAgent, pickAgents, skillsDir, type Agent } from "./install.js";
import { guideId, resolveGuide } from "./resolve.js";
import { startServer } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const HELP = `code-chapters: read code as a few brief chapters

Usage
  code-chapters [dir | guide.json]   Open the viewer for the repo containing dir (default: .)
                                     or for a single guide file.
  code-chapters check <guide.json>…  Validate guides against the spec. Exits 1 on errors.
  code-chapters install-skill        Install the authoring skill for your agents (asks which).
  code-chapters install-skill <dir>  Install it into a skills directory of your choice.

Options
  --port <n>          Port to serve on (default 4646, next free port if taken)
  --no-open           Don't open the browser
  --agent <name>      install-skill: ${Object.keys(AGENTS).join(", ")} or all; repeatable
  --project           install-skill: install into this repo instead of your home directory
  -h, --help          Show this help

Guides live in <repo>/.code-chapters/*.json. Spec: ${join(pkgRoot, "skill/code-chapters/SPEC.md")}`;

async function check(files: string[]) {
  if (files.length === 0) {
    console.error("usage: code-chapters check <guide.json>…");
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

async function install(dir: string | undefined, agents: Agent[], project: boolean) {
  const source = join(pkgRoot, "skill", "code-chapters");
  if (dir) return installSkill(source, [dir]).then(() => 0);
  const root = project ? ((await repoRoot(process.cwd())) ?? process.cwd()) : undefined;
  if (agents.length === 0) {
    if (process.stdin.isTTY) agents = await pickAgents(root);
    else {
      agents = ["claude"];
      console.log(`No --agent given; installing for Claude Code. Options: ${Object.keys(AGENTS).join(", ")}, all.`);
    }
  }
  await installSkill(
    source,
    agents.map((a) => skillsDir(a, root)),
  );
  if (agents.includes("pi")) console.log("In pi, run it with /skill:code-chapters <question>.");
  return 0;
}

async function serve(args: string[], port: number, openBrowser: boolean) {
  const target = resolve(args[0] ?? ".");
  const isFile = await stat(target)
    .then((s) => s.isFile())
    .catch(() => false);
  if (!isFile && !(await stat(target).catch(() => undefined))) {
    console.error(`No such file or directory: ${target}`);
    return 1;
  }
  const dir = isFile ? dirname(target) : target;
  const root = (await repoRoot(dir)) ?? dir;
  const { url } = await startServer({
    roots: [root],
    files: isFile ? [target] : [],
    uiDir: join(here, "ui"),
    port,
  });
  const page = isFile ? `${url}/#/g/${encodeURIComponent(guideId(target))}/guide/1` : url;
  console.log(`Code Chapters for ${relative(process.cwd(), root) || "."} at ${page}`);
  console.log("Press Ctrl+C to stop.");
  if (openBrowser) await open(page).catch(() => console.log("(Couldn't open a browser; visit the URL above.)"));
  return new Promise<number>(() => {});
}

async function main(argv: string[]) {
  const args: string[] = [];
  let port = 4646;
  let openBrowser = true;
  let project = false;
  const agents: Agent[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return (console.log(HELP), 0);
    else if (a === "--no-open") openBrowser = false;
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "--project") project = true;
    else if (a === "--agent") {
      for (const name of (argv[++i] ?? "").split(",")) {
        if (name === "all") agents.push(...(Object.keys(AGENTS) as Agent[]));
        else if (isAgent(name)) agents.push(name);
        else return (console.error(`Unknown agent "${name}". Options: ${Object.keys(AGENTS).join(", ")}, all.`), 2);
      }
    } else args.push(a);
  }
  if (args[0] === "check") return check(args.slice(1));
  if (args[0] === "install-skill") return install(args[1], [...new Set(agents)], project);
  return serve(args, port, openBrowser);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  },
);
