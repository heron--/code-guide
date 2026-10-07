import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { attachChannel, type RequestHandler } from "./channel.js";
import { repoRoot } from "./git.js";
import type { ModuleInfo } from "../shared/modules.js";
import type { Session } from "./session.js";
import { resolveChangedFile, resolveGuide, summarize, guideId } from "./resolve.js";

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
  /** Directories whose `.code-chapters/*.json` are listed. */
  roots: string[];
  /** Guide files opened explicitly. */
  files: string[];
  uiDir: string;
  port: number;
  /** The session to serve over the WebSocket channel, and what to do with its requests. */
  session?: { session: Session; onRequest: RequestHandler; modules?: ModuleInfo[] };
};

async function discover(opts: ServeOptions): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const root of opts.roots) {
    const dir = join(root, ".code-chapters");
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const n of names.filter((n) => n.endsWith(".json")).sort()) found.set(guideId(n), join(dir, n));
  }
  for (const f of opts.files) found.set(guideId(f), resolve(f));
  return found;
}

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

    const guides = await discover(opts);
    if (parts[1] === "guides" && parts.length === 2) {
      return send(res, 200, {
        roots: opts.roots,
        guides: await Promise.all([...guides.values()].map(summarize)),
      });
    }
    if (parts[1] === "guides" && parts[2]) {
      const file = guides.get(parts[2]);
      if (!file) return send(res, 404, { error: `no guide "${parts[2]}"` });
      if (parts[3] === "file") {
        // One file of the Diff tab. The client passes the commits the guide resolved to,
        // so this doesn't re-resolve the whole guide per file.
        const q = url.searchParams;
        const sha = /^[0-9a-f]{40}$/;
        const [path, base, head] = [q.get("path") ?? "", q.get("base") ?? "", q.get("head") ?? ""];
        const repo = await repoRoot(dirname(file));
        if (!repo || !sha.test(base) || !(sha.test(head) || head === "working tree"))
          return send(res, 400, { error: "bad file request" });
        const f = await resolveChangedFile(repo, base, head === "working tree" ? undefined : head, path);
        return f ? send(res, 200, f) : send(res, 404, { error: `${path} is not changed` });
      }
      const { resolved, problems } = await resolveGuide(file);
      if (!resolved) return send(res, 422, { id: parts[2], file, problems });
      return send(res, 200, resolved);
    }
    send(res, 404, { error: "not found" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { error: String(e?.message ?? e) }));
  });

  const detach = opts.session
    ? attachChannel(server, opts.session.session, opts.session.onRequest, opts.session.modules)
    : undefined;

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
          detach?.();
          server.close();
        },
      });
    });
    tryListen();
  });
}
