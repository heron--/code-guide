import { z } from "zod";

/**
 * A trace's shape, shared by its jobs (which check it) and its panel (which steps through it). Nothing here runs
 * code: every value is read from the code or inferred for the scenario, and says which.
 */

/** Most steps in one trace. */
export const MAX_STEPS = 200;
/** Most steps written at once. */
export const MAX_BATCH = 40;

const lineRange = z.string().regex(/^\d+(-\d+)?$/, 'like "42" or "42-60"');
const repoPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split(/[\\/]/).includes(".."), 'repository-relative, with no ".."')
  .describe("Repository-relative path");

export const scenarioSchema = z.object({
  title: z.string().min(1).describe("2-6 words, sentence case, naming what makes this path distinct"),
  summary: z.string().min(1).describe("One sentence: what happens on this path, from the input that triggers it"),
  packages: z
    .array(z.string().min(1))
    .min(1)
    .describe("Packages the path crosses, in the order it first enters them: directories, or import paths outside it"),
  steps: z.number().int().positive().describe("Estimated number of steps"),
});

export const scenariosSchema = z.object({
  follows: z
    .string()
    .min(1)
    .describe('What every scenario follows, in 1-3 words: "a request", "a job run", "an event"'),
  scenarios: z.array(scenarioSchema).min(2).max(3),
});

export const valueSchema = z.object({
  name: z.string().min(1).describe("The identifier or expression exactly as written on its line, e.g. resp.StatusCode"),
  line: z.number().int().positive().optional().describe("Its line in this step's file; the step's own line if omitted"),
  value: z.string().min(1).describe("Its value at this step. From the code: the literal exactly as written there"),
  type: z.string().optional(),
  from: z.enum(["code", "inferred"]).describe("code: a literal written in the source; inferred: reasoned out"),
  at: z
    .string()
    .regex(/^[^#]+#L\d+$/, 'like "src/retry.go#L27"')
    .optional()
    .describe('For a value from the code: the line where its literal is written, "path#L27"'),
  reason: z.string().optional().describe("For an inferred value: why it has this value in this scenario, briefly"),
});

export const stepSchema = z.object({
  path: repoPath,
  line: z.number().int().positive(),
  function: z.string().min(1).describe("The function this line is in, as named in the code"),
  depth: z.number().int().nonnegative().describe("Call depth: 0 for the outermost function, +1 per call entered"),
  call: z
    .string()
    .min(1)
    .optional()
    .describe("Only on the first step inside a newly entered call: one line on what that call does"),
  package: z
    .string()
    .min(1)
    .optional()
    .describe("Only for a call into code outside the repository, e.g. net/http; path and line stay at the call site"),
  text: z.string().min(1).describe("One sentence: what happens here, for this scenario"),
  values: z.array(valueSchema).optional(),
  notTaken: z
    .array(z.object({ lines: lineRange, reason: z.string().min(1) }))
    .optional()
    .describe("Branches here this scenario skips: their lines in this file, and why they're skipped"),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type Scenarios = z.infer<typeof scenariosSchema>;
export type Value = z.infer<typeof valueSchema>;
export type Step = z.infer<typeof stepSchema>;
/** A finished trace: the scenario it follows, and its steps in order. */
export type Trace = { scenario: Scenario; steps: Step[] };

/** A call, as the call stack shows it: the steps it was active for, its own included. */
export type Frame = {
  function: string;
  package: string;
  path: string;
  depth: number;
  /** First and last step (indices) it was on the stack. */
  start: number;
  end: number;
  /** What the call does, from the step that entered it. */
  summary?: string;
  /** Code outside the repository. */
  external: boolean;
};

/** A step's package: its directory in the repository, or the outside package it calls into. */
export function packageOf(s: Pick<Step, "path" | "package">): string {
  if (s.package) return s.package;
  const i = s.path.lastIndexOf("/");
  return i < 0 ? "." : s.path.slice(0, i);
}

/** A step's package, short: the last directory for code in the repository, else the whole package (net/http). */
export function shortPackage(s: Pick<Step, "path" | "package">): string {
  return s.package ?? packageOf(s).split("/").pop()!;
}

/**
 * Every call in a trace, outermost first within each start. A step with `call` enters a new call (after leaving
 * any at its depth or deeper); one without continues the call open at its depth, leaving any deeper ones.
 */
export function callFrames(steps: Step[]): { frames: Frame[]; at: number[] } {
  const frames: Frame[] = [];
  const open: Frame[] = [];
  /** The innermost frame at each step. */
  const at: number[] = [];
  steps.forEach((s, i) => {
    const entering = i === 0 || s.call !== undefined;
    while (open.length && open.at(-1)!.depth >= s.depth + (entering ? 0 : 1)) open.pop()!.end = i - 1;
    if (entering || !open.length) {
      const f: Frame = {
        function: s.function,
        package: packageOf(s),
        path: s.path,
        depth: s.depth,
        start: i,
        end: i,
        summary: s.call,
        external: !!s.package,
      };
      frames.push(f);
      open.push(f);
    }
    at.push(frames.indexOf(open.at(-1)!));
  });
  for (const f of open) f.end = steps.length - 1;
  return { frames, at };
}

/**
 * Problems with how a trace's calls nest: a call can only be entered one deeper than some open call, and a step
 * without `call` must be in the function open at its depth. `from` is where new steps start, for messages.
 */
export function nestingProblems(steps: Step[], from = 0): { where: string; message: string }[] {
  const problems: { where: string; message: string }[] = [];
  const open: string[] = [];
  steps.forEach((s, i) => {
    const where = `steps[${i}]`;
    const report = (message: string) => i >= from && problems.push({ where, message });
    if (i === 0) {
      if (s.depth !== 0) report("the first step is at depth 0");
      if (s.call === undefined) report("the first step enters the outermost function: give it `call`");
      open.splice(0, open.length, s.function);
      return;
    }
    if (s.call !== undefined) {
      if (s.depth < 1) return report("enters a call at depth 0; only the first step does that");
      if (s.depth > open.length)
        return report(`enters a call at depth ${s.depth}, but the deepest open call is at depth ${open.length - 1}`);
      open.splice(s.depth, open.length, s.function);
      return;
    }
    if (s.depth >= open.length)
      return report(
        `is at depth ${s.depth}, but no call was entered there; mark the step that enters it with \`call\``,
      );
    if (open[s.depth] !== s.function)
      return report(`is in ${s.function}, but the call open at depth ${s.depth} is ${open[s.depth]}`);
    open.splice(s.depth + 1);
  });
  return problems;
}

/** Where a step goes for each debugger control, or undefined when it can't move. */
export function stepTargets(
  steps: Step[],
  frames: Frame[],
  at: number[],
  i: number,
): { over?: number; into?: number; out?: number; back?: number } {
  const last = steps.length - 1;
  const ancestors = (f: number) => {
    const out = new Set<number>();
    for (let j = 0; j < frames.length; j++)
      if (frames[j].start <= frames[f].start && frames[j].end >= frames[f].end && frames[j].depth <= frames[f].depth)
        out.add(j);
    return out;
  };
  const here = ancestors(at[i]);
  const outer = new Set([...here].filter((f) => f !== at[i]));
  const next = (set: Set<number>) => {
    for (let j = i + 1; j <= last; j++) if (set.has(at[j])) return j;
    return undefined;
  };
  return {
    over: i < last ? (next(here) ?? last) : undefined,
    into: i < last ? i + 1 : undefined,
    out: next(outer),
    back: i > 0 ? i - 1 : undefined,
  };
}

/** Values inferred for the scenario, written in prose as `≈503`. */
export const INFERRED = "≈";
