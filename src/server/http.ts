import type { IncomingMessage, Server } from "node:http";

/** Reject remote origins and DNS rebinding before exposing local paths or starting processes. */
export function sameOrigin(req: IncomingMessage): boolean {
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host.hostname)) return false;
    return !req.headers.origin || req.headers.origin === host.origin;
  } catch {
    return false;
  }
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new Error("Expected application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function listenLocal(server: Server, requested: number): Promise<string> {
  return new Promise((ok, fail) => {
    let port = requested;
    const listen = () => server.listen(port, "127.0.0.1");
    server.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE" && port !== 0 && port < requested + 20) {
        port++;
        listen();
      } else fail(e);
    });
    server.once("listening", () => {
      const address = server.address();
      ok(`http://localhost:${typeof address === "object" && address ? address.port : port}`);
    });
    listen();
  });
}
