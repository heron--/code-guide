import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { attachChannel, type RequestHandler } from "./channel.js";
import type { ModuleInfo } from "../shared/modules.js";
import type { Session } from "./session.js";
import { checkGuide, parseGuide, resolveChangedFile } from "./resolve.js";

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

export function startServer(opts: ServeOptions): Promise<{ url: string; close: () => void }> {
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== "api") return serveStatic(opts.uiDir, url.pathname, res);

    const { session } = opts;
    const repo = session.state.repo!;
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
