import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { tool, type Harness, type HarnessEvent, type HarnessSession, type Tool } from "./types.js";

type Turn = { text: string; deltas: number; activities: string[]; cancelled: boolean; errors: string[] };

/** Records a harness session's events and resolves one turn at a time. */
class Recorder {
  events: HarnessEvent[] = [];
  private waiters: ((t: Turn) => void)[] = [];
  private current: HarnessEvent[] = [];
  onFirstDelta?: () => void;

  onEvent = (e: HarnessEvent) => {
    this.events.push(e);
    this.current.push(e);
    if (e.type === "text" && this.onFirstDelta) {
      this.onFirstDelta();
      this.onFirstDelta = undefined;
    }
    if (e.type !== "turn.end") return;
    const evs = this.current;
    this.current = [];
    const texts = evs.filter((x) => x.type === "text");
    this.waiters.shift()?.({
      text: texts.map((x) => x.delta).join(""),
      deltas: texts.length,
      activities: evs.flatMap((x) => (x.type === "activity" ? [x.activity] : [])),
      cancelled: e.cancelled ?? false,
      errors: evs.flatMap((x) => (x.type === "error" ? [x.message] : [])),
    });
  };

  next(): Promise<Turn> {
    return new Promise((r) => this.waiters.push(r));
  }
}

/**
 * The tests every harness adapter must pass. Run them against the fake adapter always, and against a real
 * one when it's installed and signed in (they talk to a real model, so they're slow and cost a little).
 */
export function harnessContract(make: () => Harness, opts: { timeout?: number } = {}) {
  const timeout = opts.timeout ?? 10_000;
  let repo: string;
  let harness: Harness;
  const calls: unknown[] = [];
  const echo = tool({
    name: "echo",
    description: "Returns the text it is given.",
    input: z.object({ text: z.string() }),
    run: async ({ text }) => {
      calls.push({ text });
      return { text };
    },
  });

  function start(tools: Tool[] = [echo]): { s: HarnessSession; r: Recorder } {
    const r = new Recorder();
    const s = harness.start({
      instructions: "You are being tested. Follow each instruction literally and keep replies short.",
      tools,
      cwd: repo,
      onEvent: r.onEvent,
    });
    return { s, r };
  }

  describe(`harness contract: ${make().name}`, () => {
    beforeAll(() => {
      repo = mkdtempSync(join(tmpdir(), "cg-harness-"));
      execFileSync("git", ["init", "-q"], { cwd: repo });
      writeFileSync(join(repo, "notes.txt"), "the secret word is pineapple\n");
      harness = make();
    });
    afterAll(() => rmSync(repo, { recursive: true, force: true }));

    test("reports a name and model, and is available", async () => {
      expect(harness.name).toBeTruthy();
      expect(harness.model).toBeTruthy();
      expect(await harness.check()).toEqual({ ok: true });
    });

    test(
      "streams text",
      async () => {
        const { s, r } = start();
        const words = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november";
        const turn = r.next();
        s.send(`Reply with exactly: ${words}`);
        const t = await turn;
        expect(t.text.trim()).toBe(words);
        expect(t.deltas).toBeGreaterThan(1);
        await s.stop();
      },
      timeout,
    );

    test(
      "calls Code Guide's tools",
      async () => {
        calls.length = 0;
        const { s, r } = start();
        const turn = r.next();
        s.send('Call the `echo` tool with {"text":"tangerine"}. Then reply with only the word it returned.');
        const t = await turn;
        expect(calls).toEqual([{ text: "tangerine" }]);
        expect(t.text).toContain("tangerine");
        expect(t.activities.length).toBeGreaterThan(0);
        await s.stop();
      },
      timeout,
    );

    test(
      "answers queued messages in order, one turn each",
      async () => {
        const { s, r } = start();
        const [a, b] = [r.next(), r.next()];
        s.send("Reply with exactly: first");
        s.send("Reply with exactly: second");
        expect((await a).text).toContain("first");
        expect((await b).text).toContain("second");
        await s.stop();
      },
      timeout * 2,
    );

    test(
      "cancels a turn and stays usable",
      async () => {
        const { s, r } = start();
        const turn = r.next();
        r.onFirstDelta = () => void s.cancel();
        s.send("Count from 1 to 400, one number per line.");
        const t = await turn;
        expect(t.cancelled).toBe(true);
        expect(t.text).not.toContain("400");
        const after = r.next();
        s.send("Reply with exactly: still here");
        expect((await after).text).toContain("still here");
        await s.stop();
      },
      timeout * 2,
    );

    test(
      "can't edit the repository",
      async () => {
        const { s, r } = start();
        const turn = r.next();
        s.send("Create a file named written.txt in the current directory containing the word hello. Use any tool.");
        await turn;
        expect(existsSync(join(repo, "written.txt"))).toBe(false);
        expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("?? notes.txt\n");
        await s.stop();
      },
      timeout,
    );
  });
}
