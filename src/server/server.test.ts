import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { startServer } from "./server";
import { Session } from "./session";

let repo: string;
const servers: { close: () => void }[] = [];
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cg-server-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "a.ts"), "one\ntwo\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  writeFileSync(join(repo, "a.ts"), "one\nTWO\n");
  writeFileSync(join(repo, "b.ts"), "new\n");
  git("add", "-A");
  git("commit", "-qm", "change");
});
afterAll(() => {
  servers.forEach((s) => s.close());
  rmSync(repo, { recursive: true, force: true });
});

async function serve(subject: Parameters<Session["append"]>[1]) {
  const session = await Session.create(repo);
  session.append("session.subject", subject as never);
  const s = await startServer({ session, onRequest: async () => {}, uiDir: repo, port: 0 });
  servers.push(s);
  return (path: string) => fetch(s.url + path).then(async (r) => ({ status: r.status, body: await r.json() }));
}

test("serves the session's change, file by file", async () => {
  const get = await serve({ subject: { type: "change", base: "main", head: "feature" }, label: "" });
  const { body } = await get("/api/diff");
  expect(body.changed).toEqual([
    { path: "a.ts", additions: 1, deletions: 1, status: "modified" },
    { path: "b.ts", additions: 1, deletions: 0, status: "added" },
  ]);
  const file = await get("/api/diff/file?path=a.ts");
  expect(file.body.lines.map((l: { k: string }) => l.k)).toEqual([" ", "-", "+"]);
  expect((await get("/api/diff/file?path=zzz.ts")).status).toBe(404);
});

test("has no diff for a question", async () => {
  const get = await serve({ subject: { type: "question", question: "Q?" }, label: "" });
  expect((await get("/api/diff")).status).toBe(404);
});
