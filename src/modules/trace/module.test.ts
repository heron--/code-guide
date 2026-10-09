import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { JobContext } from "../../server/jobs";
import trace from "./module";
import type { Scenarios, Step } from "./trace";

let repo: string;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cg-trace-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(
    join(repo, "retry.go"),
    [
      "package retry", // 1
      "const MaxAttempts = 4", // 2
      "func Do(n int) bool {", // 3
      "  if n >= MaxAttempts {", // 4
      "    return false", // 5
      "  }", // 6
      "  return check(n)", // 7
      "}", // 8
      "func check(n int) bool { return n > 0 }", // 9
    ].join("\n") + "\n",
  );
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const scenarios: Scenarios = {
  follows: "a call",
  scenarios: [
    { title: "Retries once", summary: "It retries once.", packages: ["."], steps: 3 },
    { title: "Gives up", summary: "It gives up.", packages: ["."], steps: 2 },
  ],
};
const ctx = (): JobContext => ({
  repo,
  subject: { type: "question", question: "How?" },
  label: "",
  inputs: { "scenarios-1": scenarios },
  pick: 0,
});
const job = trace.pick!;
const write = (from: number, steps: Step[], written: Step[] = []) => job.parts!.write({ from, steps }, written, ctx());

const good: Step[] = [
  {
    path: "retry.go",
    line: 4,
    function: "Do",
    depth: 0,
    call: "Decides whether to try again.",
    text: "Attempt `≈1` is under the limit.",
    values: [
      { name: "n", line: 3, value: "1", from: "inferred", reason: "The first attempt." },
      { name: "MaxAttempts", value: "4", from: "code", at: "retry.go#L2" },
    ],
    notTaken: [{ lines: "5", reason: "attempt 1 of 4" }],
  },
  { path: "retry.go", line: 9, function: "check", depth: 1, call: "Checks n.", text: "Positive, so true." },
  { path: "retry.go", line: 7, function: "Do", depth: 0, text: "Returns what check said." },
];

test("scenarios: 2-3 with distinct titles", async () => {
  const v = (s: unknown) => trace.job!.submit.validate(s, ctx());
  expect((await v(scenarios)).problems).toEqual([]);
  const same = { ...scenarios, scenarios: [scenarios.scenarios[0], scenarios.scenarios[0]] };
  expect((await v(same)).problems).toEqual([
    { level: "error", where: "scenarios[1]", message: "has the same title as another" },
  ]);
  expect((await v({ ...scenarios, scenarios: [scenarios.scenarios[0]] })).problems[0].where).toBe("scenarios");
});

test("well-formed steps are written and counted", async () => {
  const first = await write(0, good.slice(0, 2));
  expect(first.problems).toEqual([]);
  const all = await write(2, good.slice(2), first.written as Step[]);
  expect(all).toEqual({ problems: [], written: good });
  expect(job.parts!.activity(3)).toBe("3 steps written");
});

test("every step points at real lines, with values on their lines and literals where they say", async () => {
  const bad: Step[] = [
    {
      ...good[0],
      values: [
        { name: "attempt", value: "1", from: "inferred" },
        { name: "MaxAttempts", value: "5", from: "code", at: "retry.go#L2" },
        { name: "MaxAttempts", value: "4", from: "code" },
      ],
      notTaken: [{ lines: "3-5", reason: "no" }],
    },
    { ...good[1], line: 99 },
    { ...good[2], path: "nope.go" },
  ];
  const { problems } = await write(0, bad);
  expect(problems.map((p) => `${p.where}: ${p.message}`)).toEqual([
    'steps[0]: value attempt: "attempt" isn\'t on retry.go line 4; attach it to a line where it appears',
    'steps[0]: value MaxAttempts: "5" isn\'t written on retry.go#L2; values from the code are literals in the source, else inferred',
    "steps[0]: value MaxAttempts: a value from the code says `at` which line its literal is written on",
    "steps[0]: not taken lines 3-5 include the step's own line",
    "steps[1]: line 99 isn't in retry.go (9 lines)",
    "steps[2]: nope.go doesn't exist",
  ]);
});

test("call depth stays consistent across batches, and batches follow on", async () => {
  const { problems } = await write(1, [{ ...good[2], depth: 2 }], good.slice(0, 1));
  expect(problems.map((p) => p.message)).toEqual([
    "is at depth 2, but no call was entered there; mark the step that enters it with `call`",
  ]);
  expect((await write(3, good, good.slice(0, 1))).problems[0].message).toBe(
    "1 steps are written; start at 1 or before",
  );
});

test("submitting checks the count and keeps the scenario with the steps", async () => {
  const submit = (n: number, written: Step[]) => job.submit.validate({ steps: n }, ctx(), written);
  expect((await submit(1, [])).problems[0].message).toMatch(/no steps are written/);
  expect((await submit(2, good)).problems[0].message).toBe("3 steps are written, not 2");
  expect(await submit(3, good)).toEqual({ problems: [], result: { scenario: scenarios.scenarios[0], steps: good } });
});

test("the trace job's prompt names the picked scenario, and fails for one that isn't there", () => {
  expect(job.prompt(ctx())).toContain('Trace this scenario: "Retries once". It retries once.');
  expect(() => job.prompt({ ...ctx(), pick: 5 })).toThrow("There's no scenario 6 to trace");
});
