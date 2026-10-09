import type { Guide } from "../shared/guide.js";
import { INFERRED, packageOf, type Trace } from "../modules/trace/trace.js";
import type { ChatContext } from "../shared/protocol.js";
import { fileAt, splitLines } from "./git.js";
import { changeRefs } from "./resolve.js";
import type { Harness, HarnessSession } from "./harness/index.js";
import type { Session } from "./session.js";

const instructions = `You answer a reader's questions about code they're studying in Code Guide. They may be reading a guide about it: brief chapters, each one idea next to the code that proves it.

- Answer the question asked, briefly: a few sentences unless more is needed. Read the code before answering; don't guess from names.
- Cite code as Markdown links to exact lines: [the retry check](src/retry.ts#L31-L33). Use repository-relative paths. Every claim about code gets a citation.
- When a message comes with context (a chapter, a passage of prose, a step of a trace, or lines of code), it's what the reader is looking at: answer about that first.
- A trace follows one scenario through the code step by step, without running it. Its values are read from the code or inferred for the scenario (marked ${INFERRED}). Asked "what if" about a step, reason from that scenario: say what would change on the path and which values would differ, citing the lines that decide it.
- You can read files, search, and run read-only git commands. You can't edit anything.`;

/** Finished results the chat is told about: guides, quizzes and traces. */
const SEEDED = ["guide", "quiz", "trace"];

/** What the chat's agent is doing, for the terminal. */
export type AgentStatus = {
  state: "idle" | "working" | "thinking" | "writing" | "tool";
  /** The tool call, while in one. */
  activity?: string;
  /** Tokens in its context, and the model's window, as last reported. */
  context?: number;
  window?: number;
};

/**
 * One long-lived harness session per Code Guide session, for questions as they come up. It starts on the first
 * message and knows the subject and finished guides and quizzes, never job transcripts. Messages and replies
 * are session events, so every tab sees them.
 */
export class Chat {
  private harness?: HarnessSession;
  /** Reader messages waiting for (or getting) a reply, oldest first. */
  private pending: { id: string; reply?: string; failed?: boolean }[] = [];
  /** Finished results the chat has been told about. */
  private seen = new Set<string>();
  status: AgentStatus = { state: "idle" };
  private watchers = new Set<(s: AgentStatus) => void>();

  /** Called whenever `status` changes. Returns a function that stops. */
  onStatus(fn: (s: AgentStatus) => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  private setStatus(patch: Partial<AgentStatus>) {
    const next = { ...this.status, ...patch };
    if (next.state !== "tool") next.activity = undefined;
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    for (const fn of this.watchers) fn(next);
  }

  constructor(
    private session: Session,
    private agent: Harness,
  ) {}

  private nextId() {
    return `m-${this.session.state.chat.length + 1}`;
  }

  /** Messages are handled one at a time, so the harness gets them in the order they were sent. */
  private queue = Promise.resolve();

  send(text: string, context: ChatContext[]): Promise<void> {
    if (!this.session.state.subject) return Promise.reject(new Error("Choose a subject first"));
    const id = this.nextId();
    this.session.append("chat.sent", { message: id, text, context });
    const entry = { id };
    this.pending.push(entry);
    const sent = this.queue
      .then(async () => {
        const caught = await this.catchUp();
        // The subject moved to newer commits since the agent started: say so before anything else.
        const moved = this.harness && this.told !== this.about() ? (this.told = this.about()) : undefined;
        const parts = [
          moved && `The reader updated the session to newer commits. They are now studying ${moved}.`,
          caught.text,
          ...(await Promise.all(context.map((c) => this.describe(c)))),
          text,
        ];
        // A fatal error while this was prepared already failed it: sending it now would take the next reply.
        if (!this.pending.includes(entry)) return;
        const harness = this.start();
        if (this.status.state === "idle") this.setStatus({ state: "working" });
        harness.send(parts.filter(Boolean).join("\n\n"));
        // Unless it died on the spot: a new harness starts from scratch, so it's told everything again.
        if (this.harness === harness) for (const id of caught.jobs) this.seen.add(id);
      })
      .catch((e: Error) => {
        // It never reached the harness, so no reply will come: fail it here, or the next reply would be its.
        this.pending = this.pending.filter((p) => p !== entry);
        this.session.append("chat.failed", { message: this.reply(entry), error: e.message });
        throw e;
      });
    this.queue = sent.catch(() => {});
    return sent;
  }

  /** What finished since the last message: the first message gets every result so far. */
  private async catchUp(): Promise<{ text: string; jobs: string[] }> {
    const state = this.session.state;
    const out: string[] = [];
    const jobs: string[] = [];
    for (const jobId of state.jobOrder) {
      const job = state.jobs[jobId];
      if (job.status !== "finished" || !SEEDED.includes(job.kind) || this.seen.has(jobId)) continue;
      // One that can't be read fails this message, and is skipped from then on rather than failing every one.
      const result = await this.session.readResult(job.result!).catch((e: Error) => {
        this.seen.add(jobId);
        throw e;
      });
      jobs.push(jobId);
      out.push(`A ${job.kind} finished (${jobId}). The reader may refer to it:\n${JSON.stringify(result)}`);
    }
    return { text: out.join("\n\n"), jobs };
  }

  private async describe(c: ChatContext): Promise<string> {
    if (c.kind === "code") {
      const subject = this.session.state.subject!.subject;
      const repo = this.session.state.repo!;
      const refs = subject.type === "change" ? await changeRefs(repo, subject) : undefined;
      // Without it, fileAt would read the working tree instead of the change.
      if (subject.type === "change" && !refs) throw new Error(`unknown ref "${subject.head ?? subject.base}"`);
      // Removed lines are read where they still exist: the change's base.
      const ref = c.side === "old" ? refs!.base : refs?.head;
      const text = c.path.split(/[\\/]/).includes("..") ? undefined : await fileAt(repo, ref, c.path);
      const lines = text === undefined ? [] : splitLines(text).slice(c.start - 1, c.end);
      // Links in replies point at the head, so these numbers mustn't be cited as if they were.
      const where =
        c.side === "old" ? " (removed by the change; numbered as before it, so don't link to these line numbers)" : "";
      return `The reader selected ${c.path}#L${c.start}-L${c.end}${where}:\n\`\`\`\n${lines.map((l, i) => `${c.start + i}  ${l}`).join("\n")}\n\`\`\``;
    }
    const job = this.session.state.jobs[c.job];
    if (c.kind === "step") {
      const trace = job?.result ? ((await this.session.readResult(job.result)) as Trace) : undefined;
      const s = trace?.steps[c.step];
      if (!trace || !s) return "";
      const values = (s.values ?? []).map(
        (v) =>
          `\n- ${v.name} = ${v.from === "inferred" ? `${INFERRED}${v.value} (inferred${v.reason ? `: ${v.reason}` : ""})` : `${v.value} (from the code, ${v.at})`}`,
      );
      return `The reader is on step ${c.step + 1} of ${trace.steps.length} of ${c.job}, the trace of the scenario "${trace.scenario.title}": ${trace.scenario.summary}\nAt this step they're in ${packageOf(s) === "." ? "" : `${packageOf(s)} `}${s.function}, at ${s.path}#L${s.line}: ${s.text}${values.length ? `\nValues here:${values.join("")}` : ""}`;
    }
    const guide = job?.result ? ((await this.session.readResult(job.result)) as Guide) : undefined;
    const chapter = guide?.chapters[c.chapter];
    if (!chapter) return "";
    const where = `chapter ${c.chapter + 1} of ${c.job}, "${chapter.title}"`;
    return c.kind === "chapter"
      ? `The reader is on ${where}:\n${chapter.body}`
      : `The reader selected this passage from ${where}:\n> ${c.text}`;
  }

  /** What the reader is studying, as the agent is told it. */
  private about(): string {
    const { subject } = this.session.state.subject!;
    return subject.type === "change"
      ? `the change from the merge-base of ${subject.base} to ${subject.head ?? "the working tree"} (see it with \`git diff ${subject.head ? `${subject.base}...${subject.head}` : `--merge-base ${subject.base}`}\`)${subject.question ? `. The reader's question: ${subject.question}` : ""}`
      : subject.type === "path"
        ? `${subject.path}, in the working tree`
        : `this question about the working tree: ${subject.question}`;
  }
  /** The subject the running agent was last told about. */
  private told?: string;

  private start(): HarnessSession {
    if (this.harness) return this.harness;
    this.told = this.about();
    this.harness = this.agent.start({
      instructions: `${instructions}\n\nThe reader is studying ${this.told}. In the status bar: ${this.session.state.subject!.label}.`,
      tools: [],
      cwd: this.session.state.repo!,
      onEvent: (e) => {
        if (e.type === "usage") return this.setStatus({ context: e.context, window: e.window ?? this.status.window });
        if (e.type === "thinking") this.setStatus({ state: "thinking" });
        else if (e.type === "text") this.setStatus({ state: "writing" });
        else if (e.type === "activity") this.setStatus({ state: "tool", activity: e.activity });
        const head = this.pending[0];
        // A harness that dies between messages is replaced by the next one, which is told everything again.
        if (!head && e.type === "error" && e.fatal) {
          this.harness = undefined;
          this.seen.clear();
          this.setStatus({ state: "idle", context: undefined });
        }
        if (!head) return;
        if (e.type === "text") this.session.append("chat.delta", { message: this.reply(head), text: e.delta });
        else if (e.type === "error") {
          if (!head.failed) this.session.append("chat.failed", { message: this.reply(head), error: e.message });
          head.failed = true;
          if (e.fatal) {
            // Everything waiting is lost with the harness; the next message starts a new one, which catches up.
            for (const p of this.pending.slice(1))
              this.session.append("chat.failed", { message: this.reply(p), error: e.message });
            this.pending = [];
            this.harness = undefined;
            this.seen.clear();
            this.setStatus({ state: "idle", context: undefined });
          }
        } else if (e.type === "turn.end") {
          this.pending.shift();
          this.setStatus({ state: this.pending.length ? "working" : "idle" });
          if (!head.failed) this.session.append("chat.finished", { message: this.reply(head) });
        }
      },
    });
    return this.harness;
  }

  /** The reply to a reader message, announced the first time it's needed. */
  private reply(p: { id: string; reply?: string }): string {
    if (!p.reply) {
      p.reply = this.nextId();
      this.session.append("chat.started", { message: p.reply, replyTo: p.id });
    }
    return p.reply;
  }

  async stop() {
    await this.harness?.stop();
  }
}
