import type { Model } from "@mariozechner/pi-ai";
import type { AgentSession, AuthStorage, ModelRegistry, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { z } from "zod";
import { isReadOnlyGit, staysInside } from "./claude.js";
import type { Harness, HarnessSession, HarnessSessionOptions, Tool } from "./types.js";

type Pi = typeof import("@mariozechner/pi-coding-agent") & { Type: typeof import("@mariozechner/pi-ai").Type };
/** pi's own alias for a tool of any schema. */
type ToolDef = ToolDefinition<any, any>;
/** Where pi's credentials and models come from; tests pass their own, with a model pi's registry doesn't list. */
type Setup = { authStorage: AuthStorage; modelRegistry: ModelRegistry; model?: Model<any> };

/** Loaded on first use, so the default harness never pays for pi. */
let pi: Promise<Pi> | undefined;
const loadPi = () =>
  (pi ??= Promise.all([import("@mariozechner/pi-coding-agent"), import("@mariozechner/pi-ai")]).then(([agent, ai]) => ({
    ...agent,
    Type: ai.Type,
  })));

/** A short description of a pi tool call, for job progress. */
export function describeActivity(name: string, args: Record<string, unknown>): string {
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
  switch (name) {
    case "read":
      return str("path") ? `Reading ${str("path")}` : "Reading";
    case "grep":
      return str("pattern") ? `Searching for ${str("pattern")}` : "Searching";
    case "find":
      return str("pattern") ? `Finding ${str("pattern")}` : "Finding files";
    case "ls":
      return `Listing ${str("path") ?? "files"}`;
    case "bash":
      return `Running ${(str("command") ?? "a command").split("\n")[0].slice(0, 60)}`;
    default:
      return `Using ${name}`;
  }
}

/** Whether the paths a pi file tool names stay inside the repository. pi expands `~` and drops a leading `@`. */
export function piStaysInside(root: string, name: string, args: Record<string, unknown>): boolean {
  const paths = { path: args.path, ...(name === "find" ? { pattern: args.pattern } : {}) };
  if (Object.values(paths).some((v) => typeof v === "string" && /^[~@]/.test(v))) return false;
  return staysInside(root, paths);
}

/**
 * pi's read-only tools, overriding its built-ins by name: file tools confined to the repository, and `bash`
 * limited to single read-only git commands.
 */
function readTools(p: Pi, cwd: string): ToolDef[] {
  const guard = (def: ToolDef, allow: (args: Record<string, unknown>) => string | undefined) =>
    p.defineTool({
      ...def,
      async execute(id, params, ...rest) {
        const refusal = allow(params as Record<string, unknown>);
        if (refusal) throw new Error(refusal);
        return def.execute(id, params, ...rest);
      },
    });
  const inside = (name: string) => (args: Record<string, unknown>) =>
    piStaysInside(cwd, name, args) ? undefined : "Only files inside the repository can be read.";
  return [
    guard(p.createReadToolDefinition(cwd), inside("read")),
    guard(p.createGrepToolDefinition(cwd), inside("grep")),
    guard(p.createFindToolDefinition(cwd), inside("find")),
    guard(p.createLsToolDefinition(cwd), inside("ls")),
    guard(p.createBashToolDefinition(cwd), (args) =>
      isReadOnlyGit(String(args.command ?? ""))
        ? undefined
        : "Only single read-only git commands are allowed. Use read, grep, find or ls.",
    ),
  ];
}

/** Code Guide's tools as pi tools. A result marked as an error is thrown, which is how pi reports one. */
function guideTool(p: Pi, t: Tool): ToolDef {
  return p.defineTool({
    name: t.name,
    label: t.name,
    description: t.description,
    parameters: p.Type.Unsafe(z.toJSONSchema(t.input)),
    async execute(_id, params) {
      const parsed = t.input.safeParse(params);
      const result = parsed.success ? await t.run(parsed.data) : { text: parsed.error.message, isError: true };
      if (result.isError) throw new Error(result.text);
      return { content: [{ type: "text", text: result.text }], details: undefined };
    },
  });
}

/**
 * The pi coding agent, through its SDK. It runs in memory, with none of the user's extensions, skills,
 * prompt templates or context files, and only the read-only tools above plus Code Guide's own. Messages sent
 * while it's busy go into pi's follow-up queue.
 */
export class PiHarness implements Harness {
  readonly name = "pi";
  /** Until `check()` finds the model pi will use, the name asked for. */
  model: string;

  /** `model` is "provider/id"; without one, the default model set in pi. */
  constructor(
    private modelName?: string,
    private setup?: () => Setup,
  ) {
    this.model = modelName ?? "default";
  }

  private async resolve(): Promise<{ p: Pi; model: Model<any>; setup: Setup }> {
    const p = await loadPi();
    const setup: Setup =
      this.setup?.() ??
      (() => {
        const authStorage = p.AuthStorage.create();
        return { authStorage, modelRegistry: p.ModelRegistry.create(authStorage) };
      })();
    const { modelRegistry } = setup;
    let model = setup.model;
    if (model) return { p, model, setup };
    if (this.modelName) {
      const [provider, ...id] = this.modelName.split("/");
      model = modelRegistry.find(provider, id.join("/"));
      if (!model) throw new Error(`pi has no model "${this.modelName}". Name one as provider/id.`);
      if (!modelRegistry.hasConfiguredAuth(model)) throw new Error(`pi isn't signed in to ${provider}.`);
    } else {
      const settings = p.SettingsManager.create(process.cwd(), p.getAgentDir());
      const [provider, id] = [settings.getDefaultProvider(), settings.getDefaultModel()];
      model = provider && id ? modelRegistry.find(provider, id) : undefined;
      if (!model || !modelRegistry.hasConfiguredAuth(model))
        throw new Error("pi has no default model signed in. Pick one in `pi`, or pass --model provider/id.");
    }
    return { p, model, setup };
  }

  async check(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const { model } = await this.resolve();
      this.model = `${model.provider}/${model.id}`;
      return { ok: true };
    } catch (e) {
      const missing = (e as { code?: string }).code === "ERR_MODULE_NOT_FOUND";
      return { ok: false, reason: missing ? "pi isn't installed." : (e as Error).message };
    }
  }

  start(opts: HarnessSessionOptions): HarnessSession {
    let stopped = false;
    let session: AgentSession | undefined;
    const emit: HarnessSessionOptions["onEvent"] = (e) => !stopped && opts.onEvent(e);
    /** Messages handed to pi that it hasn't started on, oldest first. */
    const waiting: string[] = [];
    /** Whether pi has started on a message in the current run, which then gets a `turn.end`. */
    let answering = false;
    let cancelling = false;
    /** Text since the last tool call; replies written around tool calls are separate paragraphs. */
    let wrote = false;
    let toolSince = false;

    const ready = (async () => {
      const { p, model, setup } = await this.resolve();
      const settingsManager = p.SettingsManager.inMemory();
      const agentDir = p.getAgentDir();
      const resourceLoader = new p.DefaultResourceLoader({
        cwd: opts.cwd,
        agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: opts.instructions,
      });
      await resourceLoader.reload();
      const customTools = [...readTools(p, opts.cwd), ...opts.tools.map((t) => guideTool(p, t))];
      const created = await p.createAgentSession({
        cwd: opts.cwd,
        agentDir,
        model,
        authStorage: setup.authStorage,
        modelRegistry: setup.modelRegistry,
        tools: customTools.map((t) => t.name),
        customTools,
        resourceLoader,
        sessionManager: p.SessionManager.inMemory(),
        settingsManager,
      });
      session = created.session;
      session.subscribe((e) => {
        if (e.type === "message_start" && e.message.role === "user") {
          const c = e.message.content;
          const text = typeof c === "string" ? c : c.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
          if (waiting.includes(text)) waiting.splice(waiting.indexOf(text), 1);
          if (answering) emit({ type: "turn.end" });
          answering = true;
          wrote = toolSince = false;
        } else if (e.type === "message_update" && e.assistantMessageEvent.type === "thinking_start") {
          emit({ type: "thinking" });
        } else if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") {
          const delta = e.assistantMessageEvent.delta;
          emit({ type: "text", delta: wrote && toolSince ? `\n\n${delta}` : delta });
          wrote = true;
          toolSince = false;
        } else if (e.type === "tool_execution_start") {
          toolSince = true;
          emit({ type: "activity", activity: describeActivity(e.toolName, e.args ?? {}) });
        } else if (e.type === "message_end" && e.message.role === "assistant" && e.message.stopReason === "error") {
          emit({ type: "error", message: e.message.errorMessage ?? "pi failed.", fatal: false });
        } else if (e.type === "message_end" && e.message.role === "assistant") {
          const u = e.message.usage;
          emit({
            type: "usage",
            context: u.input + u.cacheRead + u.cacheWrite + u.output,
            window: model.contextWindow,
          });
        } else if (e.type === "agent_end") {
          if (answering) emit(cancelling ? { type: "turn.end", cancelled: true } : { type: "turn.end" });
          answering = cancelling = false;
        }
      });
      return session;
    })().catch((e: Error) => {
      emit({ type: "error", message: e.message, fatal: true });
      return undefined;
    });

    // Each message waits until pi has taken the one before, so it's either started or queued in order.
    let gate: Promise<unknown> = ready;
    const submit = (text: string) => {
      gate = gate.then(async () => {
        const s = await ready;
        if (!s || stopped) return;
        const startsRun = !s.isStreaming;
        waiting.push(text);
        await new Promise<void>((taken) => {
          s.prompt(text, {
            streamingBehavior: "followUp",
            expandPromptTemplates: false,
            preflightResult: (ok) => ok && taken(),
          }).then(
            () => startsRun && requeue(s),
            (e: Error) => {
              if (waiting.includes(text)) waiting.splice(waiting.indexOf(text), 1);
              emit({ type: "error", message: e.message, fatal: false });
              emit({ type: "turn.end" });
              taken();
            },
          );
        });
      });
    };
    /** After a run, send again what pi didn't get to: it drops follow-ups on cancel or failure. */
    const requeue = (s: AgentSession) => {
      if (!waiting.length || stopped) return;
      s.clearQueue();
      waiting.splice(0).forEach(submit);
    };

    return {
      send: submit,
      async cancel() {
        if (!session?.isStreaming || stopped) return;
        cancelling = true;
        await session.abort();
      },
      async stop() {
        stopped = true;
        const s = await ready;
        if (s?.isStreaming) await s.abort();
        s?.dispose();
      },
    };
  }
}
