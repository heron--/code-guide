import type { z } from "zod";
import type { Subject } from "../shared/protocol.js";
import type { JobState } from "../shared/state.js";
import type { Harness, HarnessSession } from "./harness/index.js";
import type { Session } from "./session.js";

export type Problem = JobState["problems"][number];

/** What a job knows when it starts: the subject and the finished results it reads. Never another job's transcript. */
export type JobContext = {
  repo: string;
  subject: Subject;
  label: string;
  /** Finished results this job reads, by the job that produced them. */
  inputs: Record<string, unknown>;
};

/** One kind of job (guide, quiz, review): what the agent is told, and how its result is submitted and checked. */
export type JobKind = {
  kind: string;
  instructions: string;
  /** The first message, which states the job's one goal. */
  prompt(ctx: JobContext): string;
  submit: {
    /** e.g. "submit_guide" */
    tool: string;
    description: string;
    input: z.ZodObject;
    /** Errors reject the submission; warnings are recorded but don't. */
    validate(input: unknown, ctx: JobContext): Promise<Problem[]>;
  };
};

export type JobRunnerOptions = {
  /** Jobs running at once. Others wait in order. */
  concurrency?: number;
  /** Submissions with errors before the job fails. */
  maxAttempts?: number;
  /** Times the agent may end its turn without an accepted submission before the job fails. */
  maxNudges?: number;
};

type Running = { kind: JobKind; module: string; inputs: string[]; harness?: HarnessSession };

/**
 * Runs jobs in the background, each in its own harness session with one goal. A job ends when a submission
 * passes validation, when it fails, or when it's cancelled. Everything it does is an event in the session log.
 */
export class JobRunner {
  private jobs = new Map<string, Running>();
  private queue: string[] = [];
  private active = new Set<string>();
  private opts: Required<JobRunnerOptions>;

  constructor(
    private session: Session,
    private harness: Harness,
    opts: JobRunnerOptions = {},
  ) {
    this.opts = { concurrency: 2, maxAttempts: 5, maxNudges: 2, ...opts };
  }

  /** Queue a job. `inputs` are finished jobs whose results it reads. Returns the job's id. */
  start(kind: JobKind, module: string, inputs: string[] = []): string {
    const state = this.session.state;
    if (!state.subject) throw new Error("Choose a subject first");
    for (const i of inputs) if (state.jobs[i]?.status !== "finished") throw new Error(`${i} isn't a finished result`);
    const n = state.jobOrder.filter((id) => state.jobs[id].kind === kind.kind).length + 1;
    const id = `${kind.kind}-${n}`;
    this.jobs.set(id, { kind, module, inputs });
    this.session.append("job.queued", { job: id, kind: kind.kind, module, inputs });
    this.queue.push(id);
    this.pump();
    return id;
  }

  /** Run a failed or cancelled job again, as a new job with the same kind, module and inputs. */
  retry(id: string): string {
    const job = this.jobs.get(id);
    const status = this.session.state.jobs[id]?.status;
    if (!job || (status !== "failed" && status !== "cancelled")) throw new Error(`${id} can't be retried`);
    return this.start(job.kind, job.module, job.inputs);
  }

  async cancel(id: string): Promise<void> {
    const status = this.session.state.jobs[id]?.status;
    if (status !== "queued" && status !== "running") throw new Error(`${id} isn't running`);
    this.queue = this.queue.filter((q) => q !== id);
    this.session.append("job.cancelled", { job: id });
    await this.end(id);
  }

  private pump() {
    while (this.active.size < this.opts.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      this.active.add(id);
      this.run(id).catch((e) => this.fail(id, (e as Error).message, []));
    }
  }

  private isOver(id: string) {
    const s = this.session.state.jobs[id]?.status;
    return s === "finished" || s === "failed" || s === "cancelled";
  }

  private async end(id: string) {
    const job = this.jobs.get(id);
    const h = job?.harness;
    if (job) job.harness = undefined;
    if (this.active.delete(id)) this.pump();
    await h?.cancel();
    await h?.stop();
  }

  private fail(id: string, error: string, problems: Problem[]) {
    if (this.isOver(id)) return;
    this.session.append("job.failed", { job: id, error, problems });
    void this.end(id);
  }

  private async run(id: string) {
    const job = this.jobs.get(id)!;
    const state = this.session.state;
    const inputs: Record<string, unknown> = {};
    for (const i of job.inputs) inputs[i] = await this.session.readResult(state.jobs[i].result!);
    const ctx: JobContext = {
      repo: state.repo!,
      subject: state.subject!.subject,
      label: state.subject!.label,
      inputs,
    };
    const { submit } = job.kind;
    let attempts = 0;
    let nudges = 0;
    let submitting = false;

    // It may have been cancelled while its inputs were read.
    if (this.isOver(id)) return;
    this.session.append("job.started", { job: id });
    const harness = this.harness.start({
      cwd: ctx.repo,
      instructions: `${job.kind.instructions}\n\nWhen you're done, call the \`${submit.tool}\` tool with the result. Your job ends only when a submission is accepted. If it's rejected, fix every error it lists and submit again.`,
      tools: [
        {
          name: submit.tool,
          description: submit.description,
          input: submit.input,
          run: async (input) => {
            const over = { text: "This job has already ended.", isError: true };
            if (this.isOver(id)) return over;
            if (submitting) return { text: "Wait for your previous submission's result first.", isError: true };
            submitting = true;
            try {
              attempts++;
              const problems = await submit.validate(input, ctx);
              // Each await is a chance for the job to be cancelled or to fail.
              if (this.isOver(id)) return over;
              const errors = problems.filter((p) => p.level === "error");
              this.session.append("job.submitted", { job: id, attempt: attempts, accepted: !errors.length, problems });
              if (!errors.length) {
                const result = await this.session.writeResult(id, input);
                if (this.isOver(id)) return over;
                this.session.append("job.finished", { job: id, result, warnings: problems });
                return { text: "Accepted. You're done; don't reply." };
              }
              if (attempts >= this.opts.maxAttempts) {
                this.fail(id, `Still had errors after ${attempts} submissions`, errors);
                return { text: "Rejected, and out of attempts.", isError: true };
              }
              return {
                text: `Rejected. Fix these errors and submit again:\n${errors.map((e) => `- ${e.where}: ${e.message}`).join("\n")}`,
                isError: true,
              };
            } finally {
              submitting = false;
            }
          },
        },
      ],
      onEvent: (e) => {
        if (this.isOver(id)) {
          if (e.type === "turn.end") void this.end(id);
          return;
        }
        if (e.type === "activity") this.session.append("job.progress", { job: id, activity: e.activity });
        else if (e.type === "error" && e.fatal) this.fail(id, e.message, []);
        else if (e.type === "turn.end" && !e.cancelled) {
          if (++nudges > this.opts.maxNudges) return this.fail(id, `Ended without an accepted ${submit.tool}`, []);
          harness.send(`You haven't made an accepted submission yet. Call \`${submit.tool}\` with the result.`);
        }
      },
    });
    job.harness = harness;
    harness.send(job.kind.prompt(ctx));
  }
}
