import { expect, test } from "vitest";
import { harnessContract } from "./contract";
import { createHarness } from "./index";
import { FakeHarness } from "./fake";

harnessContract(() => new FakeHarness());

test("only registered harnesses can be picked", () => {
  expect(createHarness("fake").name).toBe("fake");
  expect(() => createHarness("toString")).toThrow(/Unknown harness "toString"/);
});
