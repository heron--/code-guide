import { expect, test } from "vitest";
import { PROTOCOL_VERSION, type SessionEvent } from "./protocol";
import { emptyState, hasNewCommits, reduce } from "./state";

const session = (...events: [string, Record<string, unknown>][]) =>
  events.reduce(
    (s, [type, payload], i) =>
      reduce(s, { v: PROTOCOL_VERSION, seq: i + 1, at: "", session: "s", type, payload } as SessionEvent),
    emptyState("s"),
  );
const pr = { type: "change", base: "origin/main", head: "aaa", pr: 12 };
const remote = (head?: string) => ["subject.remote", { number: 12, url: "https://x/pull/12", head }] as const;

test("a pull request subject has new commits when the pull request's head moves past it", () => {
  const subject = ["session.subject", { subject: pr, label: "#12 vs origin/main" }] as [
    string,
    Record<string, unknown>,
  ];
  expect(hasNewCommits(session(subject, [...remote("aaa")]))).toBe(false);
  expect(hasNewCommits(session(subject, [...remote("bbb")]))).toBe(true);
  // Updating moves the subject's head to the pull request's.
  expect(
    hasNewCommits(
      session(subject, [...remote("bbb")], ["session.subject", { subject: { ...pr, head: "bbb" }, label: "" }]),
    ),
  ).toBe(false);
});

test("a branch subject's pull request is linked, never updated", () => {
  const branch = ["session.subject", { subject: { type: "change", base: "main", head: "feature" }, label: "" }] as [
    string,
    Record<string, unknown>,
  ];
  const s = session(branch, [...remote()]);
  expect(s.remote?.url).toBe("https://x/pull/12");
  expect(hasNewCommits(s)).toBe(false);
});
