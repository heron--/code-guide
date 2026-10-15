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

/** Text from the repository or a model, made safe to print: no escape sequences or other control characters. */
export function printable(s: string): string {
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)?|[\x00-\x1f\x7f-\x9f]+/g, " ");
}

/** Columns a character takes in a terminal, by Unicode's East Asian Width (wide CJK and emoji take two). */
const cells = (ch: string) => eastAsianWidth(ch.codePointAt(0)!);
export const widthOf = (s: string) => [...s].reduce((n, ch) => n + cells(ch), 0);

/** A line made printable and cut to fit `max` columns, ending in "…" when cut. */
export function clipLine(line: string, max: number): string {
  const l = printable(line);
  if (widthOf(l) <= max) return l;
  let cut = "";
  for (const ch of l) {
    if (widthOf(cut) + cells(ch) > max - 1) break;
    cut += ch;
  }
  return cut + "…";
}

/** What a session process reports to the console that started it, in place of drawing on the terminal. */
export type StatusReport = { log: string } | { live: string[] };

/**
 * Reports the console's content (the log of finished and failed jobs, and the live block) as messages, for a
 * session process whose console is drawn by another process. Returns a function that stops.
 */
export function reportStatus(
  session: Session,
  modules: ModuleInfo[],
  agent: { harness: string; model: string; status: () => AgentStatus; onStatus: (fn: () => void) => () => void },
  send: (report: StatusReport) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const live = () => {
    timer = undefined;
    send({ live: statusLines(session.state, modules, { ...agent, status: agent.status() }) });
  };
  const later = () => (timer ??= setTimeout(live, 100));
  const log = (e: SessionEvent) => {
    const line = logLine(e, session.state);
    if (line) send({ log: line });
  };
  session.eventsAfter(0).forEach(log);
  const stopSession = session.subscribe((e) => {
    log(e);
    later();
  });
  const stopAgent = agent.onStatus(later);
  live();
  return () => {
    stopSession();
    stopAgent();
    clearTimeout(timer);
  };
}
