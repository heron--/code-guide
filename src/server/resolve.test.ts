import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseBody } from "../shared/guide";
import { indexRange, initialVisible } from "../ui/lib/excerpt";
import { resolveGuide } from "./resolve";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
const write = (path: string, text: string) => {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const lines = (n: number, f = (i: number) => `line ${i}`) =>
  Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";

async function check(guide: object) {
  write(
    ".code-chapters/g.json",
    JSON.stringify({ spec: "code-chapters/v1", title: "T", question: "Q?", answer: "A.", ...guide }),
  );
  return resolveGuide(join(repo, ".code-chapters/g.json"));
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cc-test-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  write("a.ts", lines(30));
  write("gone.ts", lines(3));
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  write(
    "a.ts",
    lines(30, (i) => (i === 10 ? "changed 10" : `line ${i}`)),
  );
  write("new.ts", lines(5));
  git("rm", "-q", "gone.ts");
  git("add", "-A");
  git("commit", "-qm", "change");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("parseBody", () => {
  test("splits paragraphs and parses code and anchors", () => {
    const [p1, p2] = parseBody("Use `x` in [the loop](a.ts#L3-L5).\n\nSee [one line](a.ts#L7).");
    expect(p1).toEqual([
      { kind: "text", text: "Use " },
      { kind: "code", text: "x" },
      { kind: "text", text: " in " },
      { kind: "anchor", text: "the loop", path: "a.ts", range: { start: 3, end: 5 } },
      { kind: "text", text: "." },
    ]);
    expect(p2[1]).toMatchObject({ kind: "anchor", range: { start: 7, end: 7 } });
  });
});

describe("change guides", () => {
  test("resolve diffs for modified, added and deleted files", async () => {
    const { resolved, problems } = await check({
      subject: { type: "change", base: "main", head: "feature" },
      chapters: [
        {
          title: "Change line ten",
          body: "It edits [line ten](a.ts#L10) and adds [a file](new.ts#L1-L5), dropping [the old one](gone.ts#L1-L3).",
          excerpts: [{ path: "a.ts" }, { path: "new.ts" }, { path: "gone.ts" }],
        },
      ],
    });
    expect(problems).toEqual([]);
    const a = resolved!.files["a.ts"];
    expect(a).toMatchObject({ status: "modified", additions: 1, deletions: 1 });
    expect(resolved!.files["new.ts"].status).toBe("added");
    expect(resolved!.files["gone.ts"].status).toBe("deleted");
    expect(resolved!.changed!.map((c) => c.path).sort()).toEqual(["a.ts", "gone.ts", "new.ts"]);

    // An anchor on a rewritten line also covers the removed line before it.
    const [from, to] = indexRange(a, { start: 10, end: 10 })!;
    expect(a.lines[from].k).toBe("-");
    expect(a.lines[to]).toMatchObject({ k: "+", n: 10 });
    // Only the change and its context are shown at first.
    expect(initialVisible(a).filter(Boolean).length).toBe(2 + 3 * 2);
  });
});

describe("question guides", () => {
  test("report spec violations as errors and quality issues as warnings", async () => {
    const { problems } = await check({
      subject: { type: "question", ref: "main" },
      chapters: [
        {
          title: "A title that is far too long to read.",
          body: "See [here](a.ts#L40) and [elsewhere](b.ts#L1) and [a link](https://x.dev).",
          excerpts: [
            { path: "a.ts", lines: ["1-5"] },
            { path: "new.ts", lines: ["1"] },
          ],
        },
      ],
    });
    const errors = problems.filter((p) => p.level === "error").map((p) => p.message);
    const warnings = problems.filter((p) => p.level === "warning").map((p) => p.message);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("is not an anchor"),
        "file not found at main",
        expect.stringContaining("past the end of the file"),
        expect.stringContaining("isn't one of this chapter's excerpts"),
      ]),
    );
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("title is"),
        "title ends with a period",
        expect.stringContaining("link text"),
      ]),
    );
  });

  test("rejects unknown refs", async () => {
    const { resolved, problems } = await check({
      subject: { type: "question", ref: "nope" },
      chapters: [{ title: "X", body: "Y", excerpts: [{ path: "a.ts", lines: ["1"] }] }],
    });
    expect(resolved).toBeUndefined();
    expect(problems[0]).toMatchObject({ level: "error", where: "subject.ref" });
  });
});
