import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION, requestSchema, type Request, type ServerFrame } from "../shared/protocol.js";
import type { ModuleInfo } from "../shared/modules.js";
import type { ViewSettings } from "../shared/settings.js";
import type { Session } from "./session.js";

/** Handles every request except "hello". Throwing refuses the request; the message goes back to that tab. */
export type RequestHandler = (req: Exclude<Request, { type: "hello" }>) => void | Promise<void>;

export const CHANNEL_PATH = "/api/session";

/** Only pages served from this machine may connect. Browsers don't apply CORS to WebSockets. */
function localOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * One WebSocket per tab, carrying every event for the session. A tab says hello with the last event it saw;
 * the server replays everything after it, then streams live. Every tab gets every event, so tabs stay in sync.
 */
export function attachChannel(
  server: Server,
  session: Session,
  onRequest: RequestHandler,
  modules: ModuleInfo[] = [],
  view?: ViewSettings,
): () => void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== CHANNEL_PATH) return;
    if (!localOrigin(req)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws));
  });

  function connect(ws: WebSocket) {
    const send = (f: ServerFrame) => ws.send(JSON.stringify(f));
    let stop: (() => void) | undefined;
    ws.on("close", () => stop?.());
    // One request at a time per tab, in the order sent: a quick start-then-cancel must not run backwards.
    let queue = Promise.resolve();
    ws.on("message", (data) => {
      queue = queue.then(() => receive(String(data)));
    });

    async function receive(data: string) {
      let req: ReturnType<typeof requestSchema.parse>;
      try {
        req = requestSchema.parse(JSON.parse(data));
      } catch {
        return send({ type: "error", message: "Not a valid request", fatal: false });
      }
      if (req.type === "hello") {
        if (req.v !== PROTOCOL_VERSION) {
          send({
            type: "error",
            message: `This tab speaks protocol v${req.v}; the server speaks v${PROTOCOL_VERSION}. Reload the page.`,
            fatal: true,
          });
          return ws.close();
        }
        stop?.();
        send({ type: "welcome", v: PROTOCOL_VERSION, session: session.id, modules, ...(view && { view }) });
        // Replay and subscribe in the same tick, so no event falls between them.
        for (const e of session.eventsAfter(req.session === session.id ? (req.after ?? 0) : 0)) send(e);
        stop = session.subscribe(send);
        return;
      }
      if (!stop) return send({ type: "error", message: 'Say "hello" first', fatal: false });
      try {
        await onRequest(req);
      } catch (e) {
        send({ type: "error", message: (e as Error).message, fatal: false });
      }
    }
  }

  return () => {
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}
