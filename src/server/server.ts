import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { attachChannel, type RequestHandler } from "./channel.js";
import { parseGlossary, type Term } from "../shared/glossary.js";
import type { ModuleInfo } from "../shared/modules.js";
import type { Session } from "./session.js";
import { parseInput, suggestions } from "./subjects.js";
import { changedFiles } from "./git.js";
import { changeRefs, checkGuide, parseGuide, resolveChangedFile, resolveSubjectFile } from "./resolve.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export type ServeOptions = {
  uiDir: string;
  port: number;
  /** The session this server serves, and what to do with its requests. */
  session: Session;
  onRequest: RequestHandler;
  modules?: ModuleInfo[];
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function serveStatic(uiDir: string, urlPath: string, res: ServerResponse) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  let file = join(uiDir, rel);
  if (
    !file.startsWith(uiDir) ||
    !(await stat(file)
      .then((s) => s.isFile())
      .catch(() => false))
  ) {
    file = join(uiDir, "index.html");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Viewer not built. Run `npm run build` in the code-guide package.");
  }
}

/** glossary.md at the repository root, any case. No glossary, or one that doesn't parse, means no terms. */
async function readGlossary(repo: string): Promise<Term[]> {
  const name = (await readdir(repo).catch(() => [] as string[])).find((n) => n.toLowerCase() === "glossary.md");
  if (!name) return [];
  return parseGlossary(await readFile(join(repo, name), "utf8").catch(() => ""));
}

export function startServer(opts: ServeOptions): Promise<{ url: string; close: () => void }> {
  // Read once, the first time it's asked for.
  let glossary: Promise<Term[]> | undefined;
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== "api") return serveStatic(opts.uiDir, url.pathname, res);

    const { session } = opts;
    const repo = session.state.repo!;
    // The repository's glossary, if it has one, for highlighting its terms in guides.
    if (parts[1] === "glossary") return send(res, 200, await (glossary ??= readGlossary(repo)));
    // Subjects worth one click, and what typed input would mean.
    if (parts[1] === "subjects") {
      const input = url.searchParams.get("input");
      return send(res, 200, input ? await parseInput(repo, input) : await suggestions(repo));
    }
    // The session's change, for the Diff module: every changed file, then one file at a time.
    if (parts[1] === "diff") {
      const subject = session.state.subject?.subject;
      if (subject?.type !== "change") return send(res, 404, { error: "the subject isn't a change" });
      const refs = await changeRefs(repo, subject);
      if (!refs) return send(res, 404, { error: "the change's refs don't resolve" });
      if (parts[2] === "file") {
        const path = url.searchParams.get("path") ?? "";
        const f = await resolveChangedFile(repo, refs.base, refs.head, path);
        return f ? send(res, 200, f) : send(res, 404, { error: `${path} is not changed` });
      }
      return send(res, 200, { changed: await changedFiles(repo, refs.base, refs.head) });
    }
    // Any file as the subject shows it, for citations from chat and quizzes.
    if (parts[1] === "file") {
      const subject = session.state.subject?.subject;
      const path = url.searchParams.get("path") ?? "";
      const f = subject && (await resolveSubjectFile(repo, subject, path));
      return f ? send(res, 200, f) : send(res, 404, { error: `${path} not found` });
    }
    // A finished job's result, e.g. a quiz.
    if (parts[1] === "results" && parts[2]) {
      const job = session.state.jobs[parts[2]];
      if (job?.status !== "finished") return send(res, 404, { error: `no finished job "${parts[2]}"` });
      return send(res, 200, await session.readResult(job.result!));
    }
    // A finished guide, resolved against the repository for the viewer.
    if (parts[1] === "guides" && parts[2]) {
      const job = session.state.jobs[parts[2]];
      if (job?.status !== "finished" || job.kind !== "guide")
        return send(res, 404, { error: `no guide "${parts[2]}"` });
      if (parts[3] === "file") {
        // One file of the Diff tab. The client passes the commits the guide resolved to,
        // so this doesn't re-resolve the whole guide per file.
        const q = url.searchParams;
        const sha = /^[0-9a-f]{40}$/;
        const [path, base, head] = [q.get("path") ?? "", q.get("base") ?? "", q.get("head") ?? ""];
        if (!sha.test(base) || !(sha.test(head) || head === "working tree"))
          return send(res, 400, { error: "bad file request" });
        const f = await resolveChangedFile(repo, base, head === "working tree" ? undefined : head, path);
        return f ? send(res, 200, f) : send(res, 404, { error: `${path} is not changed` });
      }
      const { guide, problems } = parseGuide(await session.readResult(job.result!));
      if (!guide) return send(res, 422, { id: parts[2], file: job.result, problems });
      const { resolved, problems: all } = await checkGuide(guide, repo, { id: parts[2], file: job.result! });
      if (!resolved) return send(res, 422, { id: parts[2], file: job.result, problems: all });
      return send(res, 200, resolved);
    }
    send(res, 404, { error: "not found" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { error: String(e?.message ?? e) }));
  });

  const detach = attachChannel(server, opts.session, opts.onRequest, opts.modules);

  // Localhost only: the server reads the repository and drives an agent.
  const host = "127.0.0.1";
  return new Promise((ok, fail) => {
    let port = opts.port;
    const tryListen = () => server.listen(port, host);
    server.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE" && port !== 0 && port < opts.port + 20) {
        port++;
        tryListen();
      } else fail(e);
    });
    server.on("listening", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      ok({
        url: `http://localhost:${p}`,
        close: () => {
          detach();
          server.close();
        },
      });
    });
    tryListen();
  });
}
