import { expect, test } from "vitest";
import { requestSchema, subjectSchema } from "./protocol";
import { shortRef, subjectInputsSchema } from "./subjects";

test("inputs are optional and whitespace is trimmed", () => {
  expect(subjectInputsSchema.parse({})).toEqual({ source: "", target: "", question: "" });
  expect(subjectInputsSchema.parse({ source: " feature ", target: " main ", question: " Why? " })).toEqual({
    source: "feature",
    target: "main",
    question: "Why?",
  });
});

test("target requires a nonblank source", () => {
  for (const input of [{ target: "main" }, { source: " ", target: "main", question: "Why?" }])
    expect(subjectInputsSchema.safeParse(input).success).toBe(false);
});

test("input fields must be strings", () => {
  for (const field of ["source", "target", "question"])
    expect(subjectInputsSchema.safeParse({ [field]: 12 }).success).toBe(false);
});

test("a change retains its question in requests and session subjects", () => {
  const subject = { type: "change", base: "refs/heads/main", head: "refs/heads/feature", question: "Why?" };
  expect(subjectSchema.parse(subject)).toEqual(subject);
  expect(requestSchema.parse({ type: "subject.choose", subject })).toEqual({ type: "subject.choose", subject });
});

test("branch refs have readable labels", () => {
  expect(shortRef("refs/heads/feature/auth")).toBe("feature/auth");
  expect(shortRef("refs/remotes/origin/feature/auth")).toBe("origin/feature/auth");
  expect(shortRef("origin/main")).toBe("origin/main");
  expect(shortRef("HEAD")).toBe("HEAD");
});
