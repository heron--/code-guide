import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import WS from "ws";
import type { Request } from "../shared/protocol";
import { SessionChannel } from "../ui/lib/session";
import { startServer } from "./server";
import { Session } from "./session";

let repo: string;
let session: Session;
let server: { url: string; close: () => void };
let requests: Request[];
const channels: SessionChannel[] = [];

async function serve(s: Session) {
  server?.close();
  server = await startServer({
    roots: [],
    files: [],
    uiDir: repo,
    port: 0,
    session: {
      session: s,
      onRequest: (r) => {
        if (r.type === "job.cancel") throw new Error(`no job "${r.job}"`);
        requests.push(r);
      },
    },
  });
}

function tab() {
  const c = new SessionChannel(server.url.replace("http", "ws") + "/api/session");
  channels.push(c);
  return c;
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "cg-channel-"));
  requests = [];
  session = await Session.create(repo);
  session.append("job.queued", { job: "guide-1", kind: "guide", module: "guide", inputs: [] });
  session.append("job.started", { job: "guide-1" });
  await serve(session);
});

afterEach(() => {
  channels.splice(0).forEach((c) => c.close());
  server.close();
  rmSync(repo, { recursive: true, force: true });
});

test("a fresh tab gets the whole session, then live events", async () => {
  const c = tab();
  await until(() => c.snapshot.state?.seq === 3);
  expect(c.snapshot.state).toEqual(session.state);
  session.append("job.progress", { job: "guide-1", activity: "Reading a.ts" });
  await until(() => c.snapshot.state?.seq === 4);
  expect(c.snapshot.state?.jobs["guide-1"].activity).toBe("Reading a.ts");
});

test("tabs on the same session stay in sync", async () => {
  const [a, b] = [tab(), tab()];
  await until(() => a.snapshot.status === "open" && b.snapshot.status === "open");
  a.send({ type: "chat.send", text: "Why?", context: [] });
  await until(() => requests.length === 1);
  session.append("chat.sent", { message: "m-1", text: "Why?", context: [] });
  await until(() => a.snapshot.state?.chat.length === 1 && b.snapshot.state?.chat.length === 1);
  expect(b.snapshot.state).toEqual(session.state);
});

test("a dropped connection reconnects and loses no events", async () => {
  const c = tab();
  await until(() => c.snapshot.state?.seq === 3);
  (c as unknown as { ws: WebSocket }).ws.close();
  await until(() => c.snapshot.status === "closed");
  session.append("job.progress", { job: "guide-1", activity: "Reading a.ts" });
  session.append("job.progress", { job: "guide-1", activity: "Reading b.ts" });
  await until(() => c.snapshot.state?.seq === 5);
  expect(c.snapshot.state).toEqual(session.state);
});

test("a tab follows the server onto a new session", async () => {
  const c = tab();
  await until(() => c.snapshot.state?.seq === 3);
  const next = await Session.create(repo);
  const old = server.url;
  await serve(next);
  // Same tab, new server: point it at the new port.
  (c as unknown as { url: string }).url = server.url.replace("http", "ws") + "/api/session";
  expect(server.url).not.toBe(old);
  await until(() => c.snapshot.state?.id === next.id);
  expect(c.snapshot.state).toEqual(next.state);
});

test("refused requests come back as errors", async () => {
  const c = tab();
  await until(() => c.snapshot.status === "open");
  c.send({ type: "job.cancel", job: "quiz-9" });
  await until(() => c.snapshot.error === 'no job "quiz-9"');
});

test("a tab on another protocol version is turned away", async () => {
  const ws = new WS(server.url.replace("http", "ws") + "/api/session");
  const frames: unknown[] = [];
  ws.on("message", (d) => frames.push(JSON.parse(String(d))));
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "hello", v: 99 }));
  await new Promise((r) => ws.on("close", r));
  expect(frames).toEqual([expect.objectContaining({ type: "error", fatal: true })]);
});

test("pages from other sites can't connect", async () => {
  const ws = new WS(server.url.replace("http", "ws") + "/api/session", { headers: { origin: "https://evil.example" } });
  const err = await new Promise<Error>((r) => ws.on("error", r));
  expect(err.message).toMatch(/403/);
});
