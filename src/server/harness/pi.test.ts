import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider, type Context } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { expect, test } from "vitest";
import { harnessContract } from "./contract";
import { describeActivity, PiHarness, piStaysInside } from "./pi";

test("file tools stay inside the repository", () => {
  expect(piStaysInside("/repo", "read", { path: "src/a.ts" })).toBe(true);
  expect(piStaysInside("/repo", "grep", { pattern: "/etc/x", path: "src" })).toBe(true);
  expect(piStaysInside("/repo", "find", { pattern: "**/*.ts" })).toBe(true);
  expect(piStaysInside("/repo", "ls", {})).toBe(true);
  expect(piStaysInside("/repo", "read", { path: "/etc/passwd" })).toBe(false);
  expect(piStaysInside("/repo", "read", { path: "~/.ssh/id_rsa" })).toBe(false);
  expect(piStaysInside("/repo", "read", { path: "@/etc/passwd" })).toBe(false);
  expect(piStaysInside("/repo", "find", { pattern: "/etc/*" })).toBe(false);
  expect(piStaysInside("/repo", "ls", { path: ".." })).toBe(false);
});

test("describes tool calls as activity", () => {
  expect(describeActivity("read", { path: "src/a.ts" })).toBe("Reading src/a.ts");
  expect(describeActivity("grep", { pattern: "retry" })).toBe("Searching for retry");
  expect(describeActivity("submit_guide", {})).toBe("Using submit_guide");
});

/**
 * A scripted model behind pi's faux provider, following the same literal instructions as the fake harness,
 * so the contract runs through the real pi agent loop, tools and queue without a network.
 */
function brain(ctx: Context) {
  const last = ctx.messages.at(-1)!;
  const text = (c: typeof last.content) =>
    typeof c === "string" ? c : c.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  if (last.role === "toolResult") return fauxAssistantMessage(text(last.content));
  const said = text(last.content);
  const call = said.match(/Call the `([^`]+)` tool with (\{.*?\})\./s);
  const reply = said.match(/Reply with exactly: (.+)$/s);
  const count = said.match(/Count from 1 to (\d+)/);
  if (call) return fauxAssistantMessage(fauxToolCall(call[1], JSON.parse(call[2])), { stopReason: "toolUse" });
  if (said.startsWith("Create a file"))
    return fauxAssistantMessage(fauxToolCall("bash", { command: "echo hello > written.txt" }), {
      stopReason: "toolUse",
    });
  if (reply) return fauxAssistantMessage(fauxText(reply[1].trim()));
  if (count) return fauxAssistantMessage(Array.from({ length: Number(count[1]) }, (_, i) => i + 1).join("\n"));
  return fauxAssistantMessage("I can only read code.");
}

const faux = registerFauxProvider({ tokensPerSecond: 400, tokenSize: { min: 2, max: 4 } });
faux.setResponses(Array.from({ length: 200 }, () => brain));

const make = () =>
  new PiHarness(`${faux.getModel().provider}/${faux.getModel().id}`, () => {
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(faux.getModel().provider, "test");
    return { authStorage, modelRegistry: ModelRegistry.inMemory(authStorage), model: faux.getModel() };
  });

harnessContract(make, { timeout: 20_000 });

test("answers a message queued behind a cancelled turn", async () => {
  const turns: { text: string; cancelled?: boolean }[] = [];
  let text = "";
  const s = make().start({
    instructions: "",
    tools: [],
    cwd: process.cwd(),
    onEvent: (e) => {
      if (e.type === "text" && !turns.length && !text) void s.cancel();
      if (e.type === "text") text += e.delta;
      if (e.type === "turn.end") {
        turns.push({ text, cancelled: e.cancelled });
        text = "";
      }
    },
  });
  s.send("Count from 1 to 400, one number per line.");
  s.send("Reply with exactly: after");
  await expect.poll(() => turns.length, { timeout: 10_000 }).toBe(2);
  expect(turns[0].cancelled).toBe(true);
  expect(turns[1]).toEqual({ text: "after", cancelled: undefined });
  await s.stop();
});
