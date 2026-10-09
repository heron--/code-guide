import { expect, test } from "vitest";
import { wrapTokens } from "./FileCard";

const text = (rows: ReturnType<typeof wrapTokens>) => rows.map((r) => r.map((t) => t[0]).join(""));

test("short lines stay whole", () => {
  expect(text(wrapTokens([["return x"]], 20))).toEqual(["return x"]);
});

test("long lines wrap at a space or punctuation near the end, keeping their indent plus two", () => {
  const rows = wrapTokens([["\ts, err := "], ["strconv", "#111"], ['.Atoi(resp.Header.Get("Retry-After"))']], 40);
  expect(text(rows)).toEqual(["    s, err := strconv.Atoi(resp.Header.", '      Get("Retry-After"))']);
  // Tokens keep their colors across the cut.
  expect(rows[0][1].slice(0, 2)).toEqual(["strconv", "#111"]);
});

test("a line with nowhere to break is cut at the width", () => {
  expect(text(wrapTokens([["x".repeat(25)]], 10))).toEqual([
    "x".repeat(10),
    "  " + "x".repeat(8),
    "  " + "x".repeat(7),
  ]);
});
