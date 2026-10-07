import { describe, expect, test } from "vitest";
import { ClaudeHarness, describeActivity, isReadOnlyGit } from "./claude";
import { harnessContract } from "./contract";

describe("read-only Bash", () => {
  test.each(["git log --oneline -5", "git show HEAD:src/a.ts", "git diff main...HEAD -- src", "git blame -L 1,9 a.ts"])(
    "allows %s",
    (c) => expect(isReadOnlyGit(c)).toBe(true),
  );
  test.each([
    "git checkout main",
    "git commit -am x",
    "git log; rm -rf .",
    "git log && touch x",
    "git diff > out.patch",
    "git log $(touch x)",
    "git log `touch x`",
    "cat a.ts",
    "rm a.ts",
  ])("refuses %s", (c) => expect(isReadOnlyGit(c)).toBe(false));
});

test("describes tool calls as activity", () => {
  expect(describeActivity("Read", { file_path: "src/a.ts" })).toBe("Reading src/a.ts");
  expect(describeActivity("Grep", { pattern: "retry" })).toBe("Searching for retry");
  expect(describeActivity("mcp__code-guide__submit_guide", {})).toBe("Using submit_guide");
});

// Talks to a real model: opt in with CODE_GUIDE_LIVE=1.
if (process.env.CODE_GUIDE_LIVE)
  harnessContract(() => new ClaudeHarness(process.env.CODE_GUIDE_MODEL), { timeout: 120_000 });
