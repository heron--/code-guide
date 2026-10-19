import { expect, test } from "vitest";
import { run } from "./run";

test("aborting stops the program", async () => {
  const abort = new AbortController();
  const started = Date.now();
  const running = run(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], { cwd: ".", signal: abort.signal });
  setTimeout(() => abort.abort(), 50);
  await expect(running).rejects.toThrow();
  expect(Date.now() - started).toBeLessThan(5000);
});
