import { ClaudeHarness } from "./claude.js";
import { FakeHarness } from "./fake.js";
import type { Harness } from "./types.js";

export type { Harness, HarnessEvent, HarnessSession, Tool } from "./types.js";
export { tool } from "./types.js";

/** Every adapter, by the name users pick it with. */
export const harnesses: Record<string, (model?: string) => Harness> = {
  claude: (model) => new ClaudeHarness(model),
  fake: () => new FakeHarness(),
};

export const DEFAULT_HARNESS = "claude";

export function createHarness(name = DEFAULT_HARNESS, model?: string): Harness {
  const make = harnesses[name];
  if (!make) throw new Error(`Unknown harness "${name}". Choose one of: ${Object.keys(harnesses).join(", ")}`);
  return make(model);
}
