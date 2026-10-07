import type { Harness, HarnessSession, HarnessSessionOptions } from "./types.js";

/**
 * An in-memory harness for tests and UI work. Its "agent" follows a few literal instructions, phrased so a
 * real model follows them too; that's what lets one set of contract tests run against every adapter:
 *
 * - Call the `<tool>` tool with <json>. → calls it; replies with what it returned
 * - Reply with exactly: <text> → streams <text>, a word at a time
 * - Count from 1 to <n>, one number per line. → streams the numbers, one every few milliseconds
 *
 * Anything else gets a one-line refusal. It has no tools of its own, so it can't edit anything.
 */
export class FakeHarness implements Harness {
  readonly name = "fake";
  readonly model = "scripted";

  constructor(private delayMs = 2) {}

  async check() {
    return { ok: true as const };
  }

  start(opts: HarnessSessionOptions): HarnessSession {
    const queue: string[] = [];
    let busy = false;
    let cancelled = false;
    let stopped = false;
    const emit: HarnessSessionOptions["onEvent"] = (e) => !stopped && opts.onEvent(e);
    const sleep = () => new Promise((r) => setTimeout(r, this.delayMs));
    const stream = async (words: string[], sep: string) => {
      for (let i = 0; i < words.length && !cancelled && !stopped; i++) {
        emit({ type: "text", delta: (i ? sep : "") + words[i] });
        await sleep();
      }
    };

    const answer = async (text: string) => {
      const call = text.match(/Call the `(\w+)` tool with (\{.*?\})\./s);
      const reply = text.match(/Reply with exactly: (.+)$/s);
      const count = text.match(/Count from 1 to (\d+)/);
      if (call) {
        const t = opts.tools.find((t) => t.name === call[1]);
        if (!t) return stream([`I have no tool named ${call[1]}.`], "");
        emit({ type: "activity", activity: `Using ${t.name}` });
        const parsed = t.input.safeParse(JSON.parse(call[2]));
        const result = parsed.success ? await t.run(parsed.data) : { text: parsed.error.message, isError: true };
        return stream(result.text.split(" "), " ");
      }
      if (reply) return stream(reply[1].trim().split(" "), " ");
      if (count)
        return stream(
          Array.from({ length: Number(count[1]) }, (_, i) => String(i + 1)),
          "\n",
        );
      return stream(["I", "can", "only", "read", "code."], " ");
    };

    const drain = async () => {
      if (busy) return;
      busy = true;
      while (queue.length && !stopped) {
        cancelled = false;
        try {
          await answer(queue.shift()!);
          // `cancel()` may have set this while awaiting.
          emit((cancelled as boolean) ? { type: "turn.end", cancelled: true } : { type: "turn.end" });
        } catch (e) {
          emit({ type: "error", message: (e as Error).message, fatal: false });
          emit({ type: "turn.end" });
        }
      }
      busy = false;
    };

    return {
      send(text) {
        queue.push(text);
        void drain();
      },
      async cancel() {
        if (busy) cancelled = true;
      },
      async stop() {
        stopped = true;
      },
    };
  }
}
