import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { eventPayloads, PROTOCOL_VERSION, requestSchema, sessionEventSchema } from "./protocol";

const doc = readFileSync(new URL("../../docs/protocol.md", import.meta.url), "utf8");
const examples = [...doc.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
const envelope = { v: PROTOCOL_VERSION, seq: 1, at: "2026-10-07T09:12:03.120Z", session: "s" };

test("docs/protocol.md has a valid example of every event and request", () => {
  const events = new Set<string>();
  const requests = new Set<string>();
  for (const ex of examples) {
    if (ex.type in eventPayloads) {
      expect(() => sessionEventSchema.parse({ ...envelope, ...ex })).not.toThrow();
      events.add(ex.type);
    } else if (ex.type === "welcome" || ex.type === "error") {
      continue;
    } else {
      expect(() => requestSchema.parse(ex)).not.toThrow();
      requests.add(ex.type);
    }
  }
  expect([...events].sort()).toEqual(Object.keys(eventPayloads).sort());
  expect([...requests].sort()).toEqual(requestSchema.options.map((o) => o.shape.type.value).sort());
});

test("events are checked against their own payload", () => {
  const bad = { ...envelope, type: "job.progress", payload: { job: "guide-1" } };
  expect(sessionEventSchema.safeParse(bad).success).toBe(false);
});
