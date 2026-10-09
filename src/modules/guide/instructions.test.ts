import { expect, test } from "vitest";
import { prompt } from "./instructions";

test("a change uses the reader's question when supplied", () => {
  const message = prompt({
    type: "change",
    base: "refs/heads/main",
    head: "refs/heads/feature",
    question: "Why retries?",
  });
  expect(message).toContain("git diff refs/heads/main...refs/heads/feature");
  expect(message).toContain('Use the question "Why retries?"');
  expect(message).not.toContain("What does this change do, and why?");
});

test("a change without a question asks what it does and why", () => {
  expect(prompt({ type: "change", base: "main", head: "feature" })).toContain("What does this change do, and why?");
});
