import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseBody } from "../shared/guide";
import { Chat } from "./chat";
import { ClaudeHarness } from "./harness/claude";
import { Session } from "./session";

// Asks Claude about a selected range of this repository: opt in with CODE_GUIDE_LIVE=1.
describe.runIf(process.env.CODE_GUIDE_LIVE)("chat, live", () => {
  let repo: string;
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "cg-live-"));
    execFileSync("git", ["clone", "-q", process.cwd(), repo]);
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  test("answers about a selected range, citing it", async () => {
    const session = await Session.create(repo);
    session.append("session.subject", { subject: { type: "path", path: "src/server" }, label: "src/server" });
    const chat = new Chat(session, new ClaudeHarness(process.env.CODE_GUIDE_MODEL));
    const [start, end] = (process.env.CODE_GUIDE_RANGE ?? "").split("-").map(Number);
    await chat.send("Why is this here?", [{ kind: "code", path: "src/server/jobs.ts", start, end }]);
    while (session.state.chat.at(-1)?.from !== "agent" || session.state.chat.at(-1)?.status === "streaming")
      await new Promise((r) => setTimeout(r, 200));
    const reply = session.state.chat.at(-1)!;
    const deltas = session.eventsAfter(0).filter((e) => e.type === "chat.delta").length;
    console.log(reply.status, deltas, "deltas\n" + reply.text);
    expect(reply.status).toBe("done");
    expect(deltas).toBeGreaterThan(1);
    const cites = parseBody(reply.text)
      .flat()
      .filter((i) => i.kind === "anchor");
    expect(cites.some((c) => c.kind === "anchor" && c.path === "src/server/jobs.ts")).toBe(true);
    await chat.stop();
  }, 300_000);
});
