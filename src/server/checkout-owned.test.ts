import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Checkouts } from "./checkout";
import { GitHub } from "./github";
import { run } from "./run";

vi.mock("./run", () => ({ run: vi.fn() }));
const command = vi.mocked(run);
const base = "a".repeat(40);
const head = "b".repeat(40);
let allocated: string[];
let checkouts: Checkouts;
beforeEach(() => {
  allocated = [];
  command.mockReset().mockImplementation(async (_cmd, args, { cwd }) => {
    if (args[0] === "init") allocated.push(cwd);
    return args[0] === "merge-base" ? base : "";
  });
  const github = new GitHub(process.cwd());
  vi.spyOn(github, "commits").mockResolvedValue({ baseRefOid: base, headRefOid: head });
  checkouts = new Checkouts(github);
});
afterEach(async () => {
  await Promise.all(allocated.map((path) => rm(path, { recursive: true, force: true })));
});

test("owned checkouts can be discarded, retained, and are never deleted after release", async () => {
  const first = await checkouts.create("acme/app", 7);
  expect(first.subject).toEqual({ type: "change", base, head, pr: 7 });
  await checkouts.release(first.repo, false);
  expect(existsSync(first.repo)).toBe(false);
  const second = await checkouts.create("acme/app", 8);
  await checkouts.release(second.repo, true);
  expect(existsSync(second.repo)).toBe(true);
  await checkouts.release(second.repo, false);
  expect(existsSync(second.repo)).toBe(true);
});

test("a failed fetch removes its partial checkout", async () => {
  command.mockImplementation(async (_cmd, args, { cwd }) => {
    if (args[0] === "init") allocated.push(cwd);
    if (args[0] === "fetch") throw new Error("fetch failed");
    return "";
  });
  await expect(checkouts.create("acme/app", 7)).rejects.toThrow("fetch failed");
  expect(allocated).toHaveLength(1);
  expect(existsSync(allocated[0])).toBe(false);
});
