import type { z } from "zod";

/**
 * Code Guide drives a harness (Claude Code, pi, …) only through this interface, so nothing above an adapter
 * knows which harness is running. A harness must support all three of:
 *
 * - streaming text output
 * - custom tools defined by Code Guide (jobs submit their results through one)
 * - read-only tools: the agent can read, search and run read-only git commands, and never edits the repository
 *
 * A harness that lacks any of them is unsupported; don't write an adapter for it.
 */
export interface Harness {
  /** For the status bar, e.g. "claude-code". */
  readonly name: string;
  /** For the status bar, e.g. "opus-5.5". */
  readonly model: string;
  /** Whether the harness is installed and signed in. A reason when it isn't. */
  check(): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Start a harness session. Messages are sent with `send`; nothing happens until the first one. */
  start(opts: HarnessSessionOptions): HarnessSession;
}

export type HarnessSessionOptions = {
  /** System instructions for the agent. */
  instructions: string;
  /** Code Guide's own tools, alongside the harness's read-only ones. */
  tools: Tool[];
  /** The repository. The agent reads from here and nowhere else. */
  cwd: string;
  onEvent: (e: HarnessEvent) => void;
};

export interface HarnessSession {
  /**
   * Send a message. If the agent is busy, it's queued and answered after the current turn; every message
   * gets exactly one `turn.end`.
   */
  send(text: string): void;
  /** Stop the current turn. It ends with `turn.end` and `cancelled: true`; the session stays usable. */
  cancel(): Promise<void>;
  /** End the session. No events follow. */
  stop(): Promise<void>;
}

/** What adapters translate harness output into. Nothing harness-specific passes this point. */
export type HarnessEvent =
  /** Streamed reply text, in order. */
  | { type: "text"; delta: string }
  /** What the agent is doing, for progress, e.g. "Reading src/a.ts". */
  | { type: "activity"; activity: string }
  /** The agent started reasoning before it answers or acts. Optional: not every harness reports it. */
  | { type: "thinking" }
  /** Tokens in the agent's context after its latest model call, and the model's window. Optional. */
  | { type: "usage"; context: number; window?: number }
  /** The agent finished answering a message. */
  | { type: "turn.end"; cancelled?: boolean }
  /** The harness failed. The session can't be used after a fatal error. */
  | { type: "error"; message: string; fatal: boolean };

export type Tool<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  input: S;
  /** The result goes back to the agent. `isError` tells it the call failed and it should fix and retry. */
  run: (input: z.infer<S>) => Promise<{ text: string; isError?: boolean }>;
};

export function tool<S extends z.ZodObject>(t: Tool<S>): Tool {
  return t as unknown as Tool;
}
