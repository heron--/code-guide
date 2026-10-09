import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { markTerms, parseGlossary } from "./glossary";

test("reads this repository's glossary", () => {
  const terms = parseGlossary(readFileSync(new URL("../../GLOSSARY.md", import.meta.url), "utf8"));
  expect(terms.map((t) => t.term)).toEqual(
    expect.arrayContaining([
      "Guide",
      "Chapter",
      "Excerpt",
      "Anchor",
      "Subject",
      "Session",
      "Module",
      "Job",
      "Review",
      "Console",
    ]),
  );
  expect(terms.find((t) => t.term === "Anchor")).toMatchObject({
    definition: expect.stringMatching(/^A link in chapter prose/),
    notConfusedWith: expect.stringMatching(/plain hyperlink/),
  });
});

test("reads the Trace module's own glossary", () => {
  const terms = parseGlossary(readFileSync(new URL("../modules/trace/GLOSSARY.md", import.meta.url), "utf8"));
  expect(terms.map((t) => t.term)).toEqual(["Trace", "Scenario", "Step"]);
});

test("anything else yields no terms", () => {
  expect(parseGlossary("# Words\n\nJust prose.\n\n| a | b |\n| - | - |\n| x | y |")).toEqual([]);
});

test("marks whole words, plurals and any case, once each", () => {
  const terms = [
    { term: "Chapter", definition: "d" },
    { term: "Anchor", definition: "d" },
  ];
  const out = markTerms("Chapters hold anchors; each chapter has an anchor. Unanchored.", terms, new Set());
  expect(out.filter((p) => typeof p !== "string").map((p) => (p as { text: string }).text)).toEqual([
    "Chapters",
    "anchors",
  ]);
  expect(out.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe(
    "Chapters hold anchors; each chapter has an anchor. Unanchored.",
  );
});
