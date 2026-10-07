import {
  createSdkMcpServer,
  query,
  tool as sdkTool,
  type CanUseTool,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { realpathSync } from "node:fs";
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
  // Quotes are only grouping here (nothing else is expanded), so `'--no-index'` is checked as --no-index.
  const args = c.split(/\s+/).map((arg) => arg.replace(/["']/g, ""));
  return GIT_READ.test(c) && !/[;&|`$<>\n\\]/.test(c) && !args.some((arg) => GIT_UNSAFE.test(arg));
}

/** A path with symlinks followed, when it exists. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Whether every path a Read, Grep or Glob call names is inside the repository, after following symlinks. */
export function staysInside(root: string, input: Record<string, unknown>): boolean {
  return ["file_path", "path", "pattern"].every((k) => {
    const v = input[k];
    if (typeof v !== "string" || (k === "pattern" && !isAbsolute(v))) return true;
    // A symlink inside the repository can point outside it; reading it would follow the link.
    const target = resolve(root, v);
    const resolved = real(target);
    return inside(root, target) && (resolved === target || inside(real(root), resolved));
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

    let wroteText = false;
    let window: number | undefined;
    let context: number | undefined;
    const handle = (m: SDKMessage) => {
      if (m.type === "stream_event" && m.parent_tool_use_id === null) {
        const ev = m.event;
        if (ev.type === "content_block_start" && ev.content_block.type === "thinking") emit({ type: "thinking" });
        // Text the agent writes between tool calls is its own paragraph, not run into what follows.
        if (ev.type === "content_block_start" && ev.content_block.type === "text" && wroteText)
          emit({ type: "text", delta: "\n\n" });
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
          wroteText = true;
          emit({ type: "text", delta: ev.delta.text });
        }
      } else if (m.type === "assistant" && m.parent_tool_use_id === null) {
        const u = m.message.usage;
        if (u) {
          context =
            u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + u.output_tokens;
          emit({ type: "usage", context, window });
        }
        for (const b of m.message.content)
          if (b.type === "tool_use")
            emit({ type: "activity", activity: describeActivity(b.name, (b.input ?? {}) as Record<string, unknown>) });
      } else if (m.type === "result") {
        // The window is only reported here: report the latest context again once it's first known.
        const known = window;
        window = Object.values(m.modelUsage ?? {})[0]?.contextWindow ?? window;
        if (window !== known && context !== undefined) emit({ type: "usage", context, window });
        if (m.subtype !== "success" && !cancelling)
          emit({ type: "error", message: m.errors.join("; ") || m.subtype, fatal: false });
        emit(cancelling ? { type: "turn.end", cancelled: true } : { type: "turn.end" });
        wroteText = false;
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
