import { eastAsianWidth } from "get-east-asian-width";
import type { ModuleInfo } from "../shared/modules.js";
import { jobLabel, panelState, runProgress } from "../shared/progress.js";
import type { SessionEvent } from "../shared/protocol.js";
import type { SessionState } from "../shared/state.js";
import type { AgentStatus } from "./chat.js";
import type { Session } from "./session.js";

const STATES: Record<AgentStatus["state"], string> = {
  idle: "idle",
  working: "working",
  thinking: "thinking",
  writing: "writing a response",
  tool: "in a tool call",
};

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

function bar(fraction: number, width = 16): string {
  const full = Math.round(Math.min(1, Math.max(0, fraction)) * width);
  return `[${"█".repeat(full)}${"░".repeat(width - full)}]`;
}

/** The live block: the chat's agent, then one line per module with a job running, queued or failed. */
export function statusLines(
  state: SessionState,
  modules: ModuleInfo[],
  agent: { harness: string; model: string; status: AgentStatus },
): string[] {
  const { status: s } = agent;
  const context =
    s.context === undefined
      ? "context empty"
      : `context ${k(s.context)}${s.window ? `/${k(s.window)} (${Math.round((100 * s.context) / s.window)}%)` : ""}`;
  const doing = s.state === "tool" && s.activity ? `${STATES.tool}: ${s.activity}` : STATES[s.state];
  const lines = [`Agent  ${agent.harness} · ${agent.model} · ${context} · ${doing}`];
  const pad = Math.max(...modules.map((m) => m.label.length));
  for (const m of modules) {
    if (!m.needsJob) continue;
    const p = panelState(m, state);
    const label = m.label.padEnd(pad);
    if (p.busy) {
      const what = [p.stage, p.activity].filter(Boolean).join(" · ");
      lines.push(`${label}  ${bar(runProgress(m, state).fraction)} ${what || "queued"}`);
    } else if (p.failed) lines.push(`${label}  failed: ${p.failed.error}`);
  }
  return lines;
}

/** A line for the log above the live block, for events worth keeping. */
export function logLine(e: SessionEvent, state: SessionState): string | undefined {
  if (e.type === "session.subject") return `Subject: ${e.payload.label}`;
  const job = "job" in e.payload ? state.jobs[e.payload.job as string] : undefined;
  if (!job) return undefined;
  if (e.type === "job.finished") return `✓ ${jobLabel(job)} (${job.id})`;
  if (e.type === "job.failed") return `✗ ${jobLabel(job)} (${job.id}) failed: ${e.payload.error}`;
  return undefined;
}

type Out = {
  write(s: string): unknown;
  isTTY?: boolean;
  columns?: number;
  on?(event: "resize", fn: () => void): unknown;
  off?(event: "resize", fn: () => void): unknown;
};

/** Text from the repository or a model, made safe to print: no escape sequences or other control characters. */
export function printable(s: string): string {
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)?|[\x00-\x1f\x7f-\x9f]+/g, " ");
}

/** Columns a character takes in a terminal, by Unicode's East Asian Width (wide CJK and emoji take two). */
const cells = (ch: string) => eastAsianWidth(ch.codePointAt(0)!);
const widthOf = (s: string) => [...s].reduce((n, ch) => n + cells(ch), 0);

/**
 * The console: shows the session in the terminal while it runs: a log of finished and failed jobs, and on a terminal, a live
 * block below it with the chat's agent and each running job, redrawn in place. Returns a function that stops.
 */
export function showStatus(
  session: Session,
  modules: ModuleInfo[],
  agent: { harness: string; model: string; status: () => AgentStatus; onStatus: (fn: () => void) => () => void },
  out: Out = process.stdout,
): () => void {
  /** Display widths of the lines last drawn, to know how many rows they take now (a resize reflows them). */
  let drawn: number[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  // One row per line when drawn, or the redraw would move up too few rows: printable, and clipped by display width.
  const clip = (line: string) => {
    const l = printable(line);
    const max = (out.columns ?? Infinity) - 1;
    if (widthOf(l) <= max) return l;
    let cut = "";
    for (const ch of l) {
      if (widthOf(cut) + cells(ch) > max - widthOf("…")) break;
      cut += ch;
    }
    return cut + "…";
  };
  const clear = () => {
    const cols = out.columns ?? Infinity;
    const rows = drawn.reduce((n, w) => n + Math.max(1, Math.ceil(w / cols)), 0);
    if (rows) out.write(`\x1b[${rows}A\x1b[0J`);
    drawn = [];
  };
  const draw = () => {
    timer = undefined;
    if (!out.isTTY) return;
    const lines = statusLines(session.state, modules, {
      harness: agent.harness,
      model: agent.model,
      status: agent.status(),
    }).map(clip);
    clear();
    out.write(lines.join("\n") + "\n");
    drawn = lines.map(widthOf);
  };
  // Redraws are batched: progress can come many times a second.
  const later = () => (timer ??= setTimeout(draw, 100));

  const stopSession = session.subscribe((e) => {
    const line = logLine(e, session.state);
    if (line) {
      if (out.isTTY) clear();
      out.write(printable(line) + "\n");
      if (out.isTTY) draw();
    } else later();
  });
  const stopAgent = agent.onStatus(later);
  // What happened before this started (a subject chosen with --change, jobs already done) is logged now.
  for (const e of session.eventsAfter(0)) {
    const line = logLine(e, session.state);
    if (line) out.write(printable(line) + "\n");
  }
  // A narrower terminal reflows what's drawn; redraw at the new width.
  const resized = () => draw();
  out.on?.("resize", resized);
  draw();
  return () => {
    out.off?.("resize", resized);
    stopSession();
    stopAgent();
    clearTimeout(timer);
  };
}
