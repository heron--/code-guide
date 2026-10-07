import { cp, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { repoRoot } from "./git.js";
import { guideId, resolveGuide } from "./resolve.js";
import { startServer } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const HELP = `code-guide: read code as a few brief chapters

Usage
  code-guide [dir | guide.json]   Open the viewer for the repo containing dir (default: .)
                                  or for a single guide file.
  code-guide check <guide.json>…  Validate guides against the spec. Exits 1 on errors.
  code-guide install-skill [dir]  Copy the authoring skill to dir (default: ~/.claude/skills).

Options
  --port <n>    Port to serve on (default 4646, next free port if taken)
  --no-open     Don't open the browser
  -h, --help    Show this help

Guides live in <repo>/.code-chapters/*.json. Spec: ${join(pkgRoot, "skill/code-guide/SPEC.md")}`;

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

async function installSkill(dir?: string) {
  const target = join(resolve(dir ?? join(homedir(), ".claude", "skills")), "code-guide");
  await mkdir(dirname(target), { recursive: true });
  await cp(join(pkgRoot, "skill", "code-guide"), target, { recursive: true });
  console.log(`Installed the code-guide skill to ${target}`);
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
  console.log(`Code Guide for ${relative(process.cwd(), root) || "."} at ${page}`);
  console.log("Press Ctrl+C to stop.");
  if (openBrowser) await open(page).catch(() => console.log("(Couldn't open a browser; visit the URL above.)"));
  return new Promise<number>(() => {});
}

async function main(argv: string[]) {
  const args: string[] = [];
  let port = 4646;
  let openBrowser = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return (console.log(HELP), 0);
    else if (a === "--no-open") openBrowser = false;
    else if (a === "--port") port = Number(argv[++i]);
    else args.push(a);
  }
  if (args[0] === "check") return check(args.slice(1));
  if (args[0] === "install-skill") return installSkill(args[1]);
  return serve(args, port, openBrowser);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  },
);
