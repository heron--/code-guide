import {
  createSdkMcpServer,
  query,
  tool as sdkTool,
  type CanUseTool,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { isAbsolute, relative, resolve } from "node:path";
import type { Harness, HarnessSession, HarnessSessionOptions } from "./types.js";

const SERVER = "code-guide";
/** Built-in tools the agent gets. Nothing that writes; Bash is limited to read-only git by `canUseTool`. */
const READ_TOOLS = ["Read", "Grep", "Glob", "Bash"];
const GIT_READ = /^git (log|show|diff|blame|status|ls-files|rev-parse|merge-base|grep|cat-file)( |$)/;
/** Options that write a file, run a program, or read outside the repository. */
const GIT_UNSAFE = /^(--output|-O|--open-files-in-pager|--no-index|--ext-diff)/;

/** Allow a Bash command only if it's one read-only git command, with nothing chained or redirected. */
export function isReadOnlyGit(command: string): boolean {
  const c = command.trim();
  return GIT_READ.test(c) && !/[;&|`$<>\n\\]/.test(c) && !c.split(/\s+/).some((arg) => GIT_UNSAFE.test(arg));
}

/** Whether every path a Read, Grep or Glob call names is inside the repository. */
export function staysInside(root: string, input: Record<string, unknown>): boolean {
  return ["file_path", "path", "pattern"].every((k) => {
    const v = input[k];
    if (typeof v !== "string" || (k === "pattern" && !isAbsolute(v))) return true;
    const rel = relative(root, resolve(root, v));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

function canUseTool(root: string): CanUseTool {
  return async (name, input) => {
    if (name === "Bash") {
      return isReadOnlyGit(String(input.command ?? ""))
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "Only single read-only git commands are allowed. Use Read, Grep or Glob." };
    }
    if (name.startsWith(`mcp__${SERVER}__`)) return { behavior: "allow", updatedInput: input };
    if (READ_TOOLS.includes(name))
      return staysInside(root, input)
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "Only files inside the repository can be read." };
    return { behavior: "deny", message: "This session is read-only." };
  };
}

/** A short description of a tool call, for job progress. */
export function describeActivity(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  if (name.startsWith(`mcp__${SERVER}__`)) return `Using ${name.slice(SERVER.length + 7)}`;
  switch (name) {
    case "Read":
      return str("file_path") ? `Reading ${str("file_path")}` : "Reading";
    case "Grep":
      return str("pattern") ? `Searching for ${str("pattern")}` : "Searching";
    case "Glob":
      return str("pattern") ? `Finding ${str("pattern")}` : "Finding files";
    case "Bash":
      return `Running ${(str("command") ?? "a command").split("\n")[0].slice(0, 60)}`;
    default:
      return `Using ${name}`;
  }
}

/** The default harness: Claude Code, through the Claude Agent SDK in streaming input mode. */
export class ClaudeHarness implements Harness {
  readonly name = "claude-code";

  constructor(readonly model = "claude-opus-5-5") {}

  async check(): Promise<{ ok: true } | { ok: false; reason: string }> {
    // Starting the CLI and reading the account doesn't send a message, so it costs nothing.
    const q = query({ prompt: (async function* () {})(), options: { settingSources: [], tools: [] } });
    try {
      const info = await Promise.race([
        q.accountInfo(),
        new Promise<never>((_, fail) => setTimeout(() => fail(new Error("timed out")), 15_000)),
      ]);
      return info.tokenSource || info.apiKeySource || info.apiProvider
        ? { ok: true }
        : { ok: false, reason: "Claude Code isn't signed in. Run `claude` once to sign in." };
    } catch (e) {
      return { ok: false, reason: `Couldn't start Claude Code: ${(e as Error).message}` };
    } finally {
      q.close();
    }
  }

  start(opts: HarnessSessionOptions): HarnessSession {
    // Messages wait here until the previous turn ends, so each gets exactly one turn (the CLI would merge them).
    const waiting: string[] = [];
    let busy = false;
    let cancelling = false;
    let stopped = false;
    let wake: (() => void) | undefined;
    const poke = () => {
      const w = wake;
      wake = undefined;
      w?.();
    };
    const emit: HarnessSessionOptions["onEvent"] = (e) => !stopped && opts.onEvent(e);

    async function* input(): AsyncGenerator<SDKUserMessage> {
      while (!stopped) {
        while (!stopped && (busy || !waiting.length)) await new Promise<void>((r) => (wake = r));
        if (stopped) return;
        busy = true;
        cancelling = false;
        yield { type: "user", message: { role: "user", content: waiting.shift()! }, parent_tool_use_id: null };
      }
    }

    const server = createSdkMcpServer({
      name: SERVER,
      tools: opts.tools.map((t) =>
        sdkTool(t.name, t.description, t.input.shape, async (args) => {
          const r = await t.run(args);
          return { content: [{ type: "text", text: r.text }], isError: r.isError };
        }),
      ),
    });

    const q: Query = query({
      prompt: input(),
      options: {
        cwd: opts.cwd,
        model: this.model,
        systemPrompt: opts.instructions,
        tools: READ_TOOLS,
        mcpServers: { [SERVER]: server },
        canUseTool: canUseTool(resolve(opts.cwd)),
        permissionMode: "default",
        // Don't load the user's or project's settings: their permission rules could allow edits.
        settingSources: [],
        includePartialMessages: true,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "code-guide" },
      },
    });

    const handle = (m: SDKMessage) => {
      if (m.type === "stream_event" && m.parent_tool_use_id === null) {
        const ev = m.event;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta")
          emit({ type: "text", delta: ev.delta.text });
      } else if (m.type === "assistant" && m.parent_tool_use_id === null) {
        for (const b of m.message.content)
          if (b.type === "tool_use")
            emit({ type: "activity", activity: describeActivity(b.name, (b.input ?? {}) as Record<string, unknown>) });
      } else if (m.type === "result") {
        if (m.subtype !== "success" && !cancelling)
          emit({ type: "error", message: m.errors.join("; ") || m.subtype, fatal: false });
        emit(cancelling ? { type: "turn.end", cancelled: true } : { type: "turn.end" });
        busy = false;
        poke();
      }
    };

    void (async () => {
      try {
        for await (const m of q) handle(m);
      } catch (e) {
        emit({ type: "error", message: (e as Error).message, fatal: true });
      }
    })();

    return {
      send(text) {
        waiting.push(text);
        poke();
      },
      async cancel() {
        if (!busy) return;
        cancelling = true;
        await q.interrupt();
      },
      async stop() {
        stopped = true;
        poke();
        q.close();
      },
    };
  }
}
