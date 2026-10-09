import { z } from "zod";
import type { Guide, Problem } from "../../shared/guide.js";
import type { JobContext, JobKind } from "../../server/jobs.js";
import { fileAt, revParse, splitLines } from "../../server/git.js";
import { glossaryNote } from "../../server/glossary.js";
import { prompt as guidePrompt } from "../guide/instructions.js";
import { defineModule } from "../types.js";
import {
  INFERRED,
  MAX_BATCH,
  MAX_STEPS,
  nestingProblems,
  scenariosSchema,
  stepSchema,
  type Scenarios,
  type Step,
  type Trace,
} from "./trace.js";

/** Most words in a scenario title, and in a step's sentence. */
export const TITLE_WORDS = 6;
export const STEP_WORDS = 35;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const zodProblems = (error: z.ZodError, where: string): Problem[] =>
  error.issues.map((i) => ({ level: "error", where: i.path.join(".") || where, message: i.message }));

/** The finished guide among a job's inputs, if it was given one. */
function guideIn(ctx: JobContext): Guide | undefined {
  return Object.values(ctx.inputs).find((r): r is Guide => !!r && typeof r === "object" && "chapters" in r);
}

const scenarioInstructions = `You propose scenarios for a trace: concrete situations a reader can follow through the code one step at a time, like a debugger, without running anything. Another job writes the trace for the scenario the reader picks; you only propose.

- Propose 2 or 3 scenarios. Each is one concrete situation with a specific input (a request that gets a 503 and then a 200; a job whose context is cancelled mid-wait), never "the happy path" in general.
- Make them distinct: each leads through a meaningfully different path (succeeds on retry / exhausts retries / cancelled mid-wait), not variations of one path with different values.
- Each must be plausible from the code. Read the entry points and the branches that decide the path before proposing, but don't trace in detail: be quick, the reader is waiting to choose.
- Title: 2-${TITLE_WORDS} words, sentence case, naming what makes the path distinct ("Succeeds on the second attempt"). Summary: one sentence saying what happens, from the input that triggers it.
- Packages: the ones the path crosses, in the order it first enters them: the directory for code in the repository (internal/api), the import path for code outside it (net/http).
- Steps: about how many stops a trace would make, one per line where something decisive happens.
- \`follows\`: what every scenario follows, in 1-3 words ("a request", "a job run").

You can read files, search, and run read-only git commands. Submit with \`submit_scenarios\`; fix any errors it returns and submit again.`;

const scenarioJob: JobKind = {
  kind: "scenarios",
  label: "Proposing trace scenarios",
  instructions: scenarioInstructions,
  prompt: (ctx) => {
    const guide = guideIn(ctx);
    const seen = guide
      ? `\n\nThe reader has a guide about it, "${guide.title}", whose chapters are: ${guide.chapters.map((c) => c.title).join("; ")}. Scenarios can follow the path those chapters explain.`
      : "";
    return `Propose scenarios to trace. The reader's request was:\n\n> ${guidePrompt(ctx.subject)}${seen}${glossaryNote(ctx.repo)}`;
  },
  submit: {
    tool: "submit_scenarios",
    description: "Submit 2-3 concrete, distinct scenarios to trace, each with a title, summary, packages and steps.",
    input: scenariosSchema,
    async validate(input) {
      const parsed = scenariosSchema.safeParse(input);
      if (!parsed.success) return { problems: zodProblems(parsed.error, "scenarios") };
      const problems: Problem[] = [];
      const titles = new Set<string>();
      parsed.data.scenarios.forEach((s, i) => {
        const where = `scenarios[${i}]`;
        const title = s.title.trim().toLowerCase();
        if (titles.has(title)) problems.push({ level: "error", where, message: "has the same title as another" });
        titles.add(title);
        if (words(s.title) > TITLE_WORDS)
          problems.push({ level: "warning", where, message: `title is over ${TITLE_WORDS} words` });
        if (s.steps > MAX_STEPS)
          problems.push({ level: "error", where, message: `${s.steps} steps; a trace has at most ${MAX_STEPS}` });
      });
      return { problems, result: parsed.data };
    },
  },
};

const traceInstructions = `You write a trace: one concrete scenario followed through the code step by step, like a debugger, across files. Nothing runs. Every value you give is either read from the code or inferred for this scenario, and you say which; the reader trusts the trace only because of that.

# Investigate first

Read every function the path passes through before writing a step. Follow the scenario's input from where it enters to where the path ends. Decide which branch each condition takes for this scenario, and why.

# Steps

A step is one line the trace stops at. Stop where something decisive happens: a call, a branch decided, a value computed that matters later, a return. Don't stop on plumbing that does what its name says. A typical trace has 15-40 steps; never more than ${MAX_STEPS}.

- \`path\` and \`line\`: the line, in the repository, as the reader sees it (for a change, its new side).
- \`function\`: the function the line is in, as named in the code. \`depth\`: 0 for the outermost function, one more for each call entered.
- \`call\`: only on the first step inside a call just entered (and on the very first step): one line on what the call does, e.g. "Looks for a Retry-After header in seconds."
- Calls into code outside the repository (the standard library, a dependency) get one step at the call site: \`call\` set, \`depth\` one deeper, and \`package\` naming it (net/http). Don't follow them further.
- \`text\`: one sentence, at most ${STEP_WORDS} words, saying what happens here in this scenario and why it matters. Say what it means, not what the code says. Write values in backticks; mark inferred ones with ${INFERRED}: "This \`${INFERRED}503\` carries no Retry-After header".
- \`values\`: values the reader needs here, for identifiers on this line or on lines run since the last step (a function's parameters, on its signature line). \`name\` is written exactly as it appears on its \`line\`.
  - \`from: "code"\` only for a literal written in the source (a constant, a default): \`value\` is the literal exactly as written, and \`at\` the line it's written on ("src/retry.go#L27"), which may be in another file.
  - Everything that depends on the scenario is \`from: "inferred"\`, with a short \`reason\` when it isn't obvious ("The scenario's 503 has no Retry-After header").
- \`notTaken\`: where the code branches here and this scenario doesn't take a branch, its lines in this file and a short reason ("attempt 1 of 4, and GET is idempotent"). The reader sees them collapsed in place.

# Writing it

Write the steps in order with \`write_steps\`, ${MAX_BATCH} or fewer at a time: \`from\` is the index of the first step in the batch (0 for the first batch, then the number written so far). Each batch is checked as it's written; to change earlier steps, write again from the first one to change. When every step is written, call \`submit_trace\` with the number of steps.

You can read files, search, and run read-only git commands. Fix any errors the tools return and try again.`;

const writeInput = z.object({
  from: z.number().int().nonnegative().describe("Index of the first step in this batch: the number written before it"),
  steps: z.array(stepSchema).min(1).max(MAX_BATCH),
});

/** Reads files at the ref the reader sees: the change's head, or the working tree. Undefined for a bad ref. */
async function reader(ctx: JobContext) {
  const head = ctx.subject.type === "change" ? ctx.subject.head : undefined;
  const ref = head ? await revParse(ctx.repo, head) : undefined;
  if (head && !ref) return undefined;
  const files = new Map<string, Promise<string[] | undefined>>();
  return (path: string) => {
    if (!files.has(path))
      files.set(
        path,
        fileAt(ctx.repo, ref, path).then((t) => (t === undefined ? undefined : splitLines(t))),
      );
    return files.get(path)!;
  };
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** Check steps against the code: lines exist, values sit on their lines, literals are where they say. */
async function checkSteps(steps: Step[], first: number, read: (path: string) => Promise<string[] | undefined>) {
  const problems: Problem[] = [];
  for (const [k, s] of steps.entries()) {
    const where = `steps[${first + k}]`;
    const err = (message: string) => problems.push({ level: "error", where, message });
    const lines = await read(s.path);
    if (!lines) {
      err(`${s.path} doesn't exist`);
      continue;
    }
    const inFile = (n: number) => n >= 1 && n <= lines.length;
    if (!inFile(s.line)) {
      err(`line ${s.line} isn't in ${s.path} (${lines.length} lines)`);
      continue;
    }
    if (words(s.text) > STEP_WORDS)
      problems.push({ level: "warning", where, message: `text is ${words(s.text)} words; keep it to ${STEP_WORDS}` });
    for (const v of s.values ?? []) {
      const line = v.line ?? s.line;
      const vw = `value ${v.name}`;
      if (!inFile(line)) err(`${vw}: line ${line} isn't in ${s.path}`);
      else if (!squash(lines[line - 1]).includes(squash(v.name)))
        err(`${vw}: "${v.name}" isn't on ${s.path} line ${line}; attach it to a line where it appears`);
      if (v.from === "inferred") continue;
      if (!v.at) {
        err(`${vw}: a value from the code says \`at\` which line its literal is written on`);
        continue;
      }
      const [path, n] = v.at.split("#L");
      const source = path.split(/[\\/]/).includes("..") ? undefined : await read(path);
      const text = source?.[Number(n) - 1];
      if (text === undefined) err(`${vw}: ${v.at} doesn't exist`);
      else if (!squash(text).includes(squash(v.value)))
        err(
          `${vw}: "${v.value}" isn't written on ${v.at}; values from the code are literals in the source, else inferred`,
        );
    }
    for (const b of s.notTaken ?? []) {
      const [start, end = start] = b.lines.split("-").map(Number);
      if (start > end || !inFile(start) || !inFile(end)) err(`not taken lines ${b.lines} aren't in ${s.path}`);
      else if (s.line >= start && s.line <= end) err(`not taken lines ${b.lines} include the step's own line`);
    }
  }
  return problems;
}

const traceJob: JobKind = {
  kind: "trace",
  label: "Writing the trace",
  instructions: traceInstructions,
  prompt: (ctx) => {
    const { scenarios } = Object.values(ctx.inputs)[0] as Scenarios;
    const s = scenarios[ctx.pick ?? -1];
    if (!s) throw new Error(`There's no scenario ${(ctx.pick ?? -1) + 1} to trace`);
    return `Trace this scenario: "${s.title}". ${s.summary}\n\nIt was proposed as crossing ${s.packages.join(", ")} in about ${s.steps} steps; follow the code, not the estimate. The reader's request was:\n\n> ${guidePrompt(ctx.subject)}${glossaryNote(ctx.repo)}`;
  },
  parts: {
    tool: "write_steps",
    description: `Write up to ${MAX_BATCH} steps of the trace, in order, starting at index \`from\`. Each batch is checked against the code as it's written.`,
    input: writeInput,
    activity: (n) => `${n} step${n === 1 ? "" : "s"} written`,
    async write(input, written, ctx) {
      const parsed = writeInput.safeParse(input);
      if (!parsed.success) return { problems: zodProblems(parsed.error, "steps") };
      const { from, steps } = parsed.data;
      if (from > written.length)
        return {
          problems: [
            {
              level: "error",
              where: "from",
              message: `${written.length} steps are written; start at ${written.length} or before`,
            },
          ],
        };
      const all = [...(written as Step[]).slice(0, from), ...steps];
      if (all.length > MAX_STEPS)
        return { problems: [{ level: "error", where: "steps", message: `${all.length} steps; at most ${MAX_STEPS}` }] };
      const read = await reader(ctx);
      if (!read)
        return { problems: [{ level: "error", where: "steps", message: "the change's head doesn't resolve" }] };
      const problems: Problem[] = [
        ...nestingProblems(all, from).map((p): Problem => ({ level: "error", ...p })),
        ...(await checkSteps(steps, from, read)),
      ];
      return { problems, written: all };
    },
  },
  submit: {
    tool: "submit_trace",
    description: "Finish the trace, once every step is written with write_steps.",
    input: z.object({ steps: z.number().int().positive().describe("How many steps the trace has") }),
    async validate(input, ctx, written = []) {
      const { steps } = input as { steps: number };
      if (!written.length)
        return {
          problems: [{ level: "error", where: "steps", message: "no steps are written; use write_steps first" }],
        };
      if (steps !== written.length)
        return {
          problems: [{ level: "error", where: "steps", message: `${written.length} steps are written, not ${steps}` }],
        };
      const { scenarios } = Object.values(ctx.inputs)[0] as Scenarios;
      const result: Trace = { scenario: scenarios[ctx.pick!], steps: written as Step[] };
      // Warnings from batches are recorded on the finished job, for the steps as finally written.
      const problems = (written as Step[]).flatMap((s, i): Problem[] =>
        words(s.text) > STEP_WORDS
          ? [
              {
                level: "warning",
                where: `steps[${i}]`,
                message: `text is ${words(s.text)} words; keep it to ${STEP_WORDS}`,
              },
            ]
          : [],
      );
      return { problems, result };
    },
  },
};

export default defineModule({
  name: "trace",
  label: "Trace",
  icon: ["M2.5 13.5h11v-3h-11z", "M4.5 10.5v-3h7v3", "M6.5 7.5v-3h3v3"],
  showsProgress: true,
  reads: ["guide"],
  job: scenarioJob,
  pick: traceJob,
});
