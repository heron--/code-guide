import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import quiz, { type Quiz } from "./module";

let repo: string;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cg-quiz-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.ts"), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const ctx = () => ({ repo, subject: { type: "question" as const, question: "Q?" }, label: "", inputs: {} });
const question = (over: Partial<Quiz["questions"][number]> = {}): Quiz["questions"][number] => ({
  question: "What does line 3 say?",
  options: [
    { text: "line 3", correct: true },
    { text: "line 4", correct: false },
    { text: "nothing", correct: false },
  ],
  explanation: "It says so.",
  cite: { path: "a.ts", lines: "2-4" },
  ...over,
});
const validate = (q: unknown) => quiz.job!.submit.validate(q, ctx());

test("a well-formed quiz passes", async () => {
  expect((await validate({ questions: [question(), question(), question()] })).problems).toEqual([]);
});

test("every question has exactly one correct option", async () => {
  const two = question({
    options: [
      { text: "a", correct: true },
      { text: "b", correct: true },
      { text: "c", correct: false },
    ],
  });
  const { problems } = await validate({ questions: [question(), two, question()] });
  expect(problems).toEqual([
    { level: "error", where: "questions[1]", message: "has 2 correct options; it needs exactly 1" },
  ]);
});

test("cited lines must exist", async () => {
  const { problems } = await validate({
    questions: [
      question({ cite: { path: "a.ts", lines: "18-30" } }),
      question({ cite: { path: "b.ts", lines: "1" } }),
      question(),
    ],
  });
  expect(problems.map((p) => p.message)).toEqual(["lines 18-30 aren't in a.ts (20 lines)", "b.ts doesn't exist"]);
});

test("3-5 questions", async () => {
  expect((await validate({ questions: [question()] })).problems[0]).toMatchObject({ where: "questions" });
});

test("a change whose head is gone isn't read from the working tree instead", async () => {
  const gone = { ...ctx(), subject: { type: "change" as const, base: "HEAD", head: "deleted-branch" } };
  const { problems } = await quiz.job!.submit.validate({ questions: [question(), question(), question()] }, gone);
  expect(problems).toEqual([{ level: "error", where: "quiz", message: 'unknown ref "deleted-branch"' }]);
});
