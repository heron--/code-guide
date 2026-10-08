import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { parseGlossary } from "../shared/glossary";
import {
  generatedGlossary,
  generateGlossary,
  glossaryJob,
  glossaryMarkdown,
  glossaryNote,
  glossaryPath,
} from "./glossary";
import type { JobRunner } from "./jobs";
import { Session } from "./session";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cg-glossary-"));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const table = "| Term | Definition |\n| --- | --- |\n| **Widget** | A thing. |\n";

test("the repository's own glossary wins over a generated one", () => {
  expect(glossaryPath(repo)).toBeUndefined();
  expect(glossaryNote(repo)).toBe("");
  mkdirSync(join(repo, ".code-guide"));
  writeFileSync(generatedGlossary(repo), table);
  expect(glossaryPath(repo)).toBe(generatedGlossary(repo));
  writeFileSync(join(repo, "Glossary.md"), table);
  expect(glossaryPath(repo)).toBe(join(repo, "Glossary.md"));
  expect(glossaryNote(repo)).toContain("`Glossary.md`");
});

test("a generated glossary reads back as the terms it was written from", () => {
  const terms = [
    { term: "Widget", definition: "A thing the app draws.", notConfusedWith: "A gadget, which it buys." },
    { term: "Sprocket", definition: "A turning part." },
  ];
  expect(parseGlossary(glossaryMarkdown(terms))).toEqual(terms);
});

test("a submission needs distinct terms that fit in one table row each, and is saved once valid", async () => {
  const ctx = { repo } as never;
  const t = (term: string, definition = "A thing.") => ({ term, definition });
  const bad = await glossaryJob.submit.validate({ terms: [t("A"), t("a"), t("C | D")] }, ctx);
  expect(bad.problems.map((p) => p.message)).toEqual([
    '"a" is listed twice',
    "no | or line breaks: each term is one table row",
  ]);
  expect(glossaryPath(repo)).toBeUndefined();
  const ok = await glossaryJob.submit.validate({ terms: [t("A"), t("B"), t("C")] }, ctx);
  expect(ok.problems).toEqual([]);
  expect(parseGlossary(readFileSync(generatedGlossary(repo), "utf8")).map((x) => x.term)).toEqual(["A", "B", "C"]);
});

test("starts once per repository without a glossary", async () => {
  const session = await Session.create(repo);
  const started: string[] = [];
  const runner = {
    start: (kind: { kind: string }) => {
      session.append("job.queued", { job: "glossary-1", kind: kind.kind, module: "glossary", inputs: [] });
      started.push(kind.kind);
      return "glossary-1";
    },
  } as unknown as JobRunner;
  generateGlossary(session, runner);

  session.append("session.subject", { subject: { type: "path", path: "." }, label: "." });
  await Promise.resolve();
  expect(started).toEqual(["glossary"]);
  // The same session's subject again (e.g. updated to new commits) doesn't start a second one.
  session.append("session.subject", { subject: { type: "path", path: "." }, label: "." });
  await Promise.resolve();
  expect(started).toEqual(["glossary"]);
});

test("doesn't start when the repository has a glossary", async () => {
  writeFileSync(join(repo, "glossary.md"), table);
  const session = await Session.create(repo);
  const started: string[] = [];
  const runner = { start: () => started.push("x") } as unknown as JobRunner;
  generateGlossary(session, runner);
  session.append("session.subject", { subject: { type: "path", path: "." }, label: "." });
  await Promise.resolve();
  expect(started).toEqual([]);
});
