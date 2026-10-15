import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import type { HistoryItem } from "../shared/launcher";
import { LauncherConsole, type ConsoleActions } from "./screen";

type Key = { name?: string; ctrl?: boolean };

/** A terminal: keys go in, everything written is kept, and raw mode is tracked. */
function terminal({ tty = true, raw = false } = {}) {
  const input = Object.assign(new EventEmitter(), {
    isTTY: tty,
    isRaw: raw,
    setRawMode: vi.fn(function (this: { isRaw: boolean }, r: boolean) {
      input.isRaw = r;
    }),
    resume: vi.fn(),
    pause: vi.fn(),
  });
  let written = "";
  const output = { isTTY: tty, columns: 80, rows: 20, write: (s: string) => (written += s) };
  return {
    input,
    output,
    written: () => written,
    clear: () => (written = ""),
    /** The last frame drawn, as plain text. */
    screen: () =>
      written
        .split(/\x1b\[\d+;1H/)
        .slice(-20)
        .map((l) => l.replace(/\x1b\[K|\x1b\[[\d;]*m/g, ""))
        .join("\n"),
    press: (name: string, extra: Key = {}) => input.emit("keypress", "", { name, ...extra }),
  };
}

function actions(keep = false, past: HistoryItem[] = []): ConsoleActions & { saved: boolean[] } {
  const saved: boolean[] = [];
  return {
    saved,
    keepClones: async () => keep,
    setKeepClones: async (k) => {
      saved.push(k);
      keep = k;
    },
    history: async () => past,
    openBrowser: vi.fn(),
    endSession: vi.fn(async () => {}),
    quit: vi.fn(),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("takes over the screen, and leaving restores the screen, cursor and raw mode exactly", async () => {
  const t = terminal({ raw: false });
  const c = new LauncherConsole("1.0", actions(), t.input, t.output);
  c.start();
  expect(t.written().startsWith("\x1b[?1049h\x1b[?25l")).toBe(true);
  expect(t.input.setRawMode).toHaveBeenLastCalledWith(true);
  c.stop();
  expect(t.written().endsWith("\x1b[?25h\x1b[?1049l")).toBe(true);
  expect(t.input.isRaw).toBe(false);
  expect(t.input.pause).toHaveBeenCalled();
  expect(t.input.listenerCount("keypress")).toBe(0);
  // Stopping twice (an exit handler after a normal stop) writes nothing more.
  t.clear();
  c.stop();
  expect(t.written()).toBe("");
});

test("a terminal that reports no size is drawn at 80×24", () => {
  const t = terminal();
  Object.assign(t.output, { columns: 0, rows: 0 });
  const c = new LauncherConsole("1.0", actions(), t.input, t.output);
  c.start();
  const plain = t.written().replace(/\x1b\[[\d;]*m/g, "");
  expect(plain).toContain("\x1b[24;1Hs settings · h history · o open browser · q quit");
  expect(plain).toContain("Session   none · choose a subject in the browser");
  c.stop();
});

test("a terminal already in raw mode is left in raw mode", () => {
  const t = terminal({ raw: true });
  const c = new LauncherConsole("1.0", actions(), t.input, t.output);
  c.start();
  c.stop();
  expect(t.input.isRaw).toBe(true);
});

test("the home view shows GitHub, the session, its progress and the log", async () => {
  const t = terminal();
  const c = new LauncherConsole("1.0", actions(), t.input, t.output);
  c.start();
  c.setUrl("http://localhost:4646");
  c.setGitHub({ ok: true, login: "reader", host: "github.com" });
  c.setSession({ url: "http://localhost:5000", label: "acme/app#7" });
  c.setLive(["Guide  [████░░░░] Writing the guide"]);
  c.log("Subject: #7 vs main");
  await settle();
  const screen = t.screen();
  expect(screen).toContain("Browser   http://localhost:4646");
  expect(screen).toContain("GitHub    ✓ reader on github.com");
  expect(screen).toContain("Session   acme/app#7 · http://localhost:5000");
  expect(screen).toContain("Writing the guide");
  expect(screen).toContain("Subject: #7 vs main");
  expect(screen).toContain("Settings  discard PR checkouts");
  expect(screen).toContain("e end session");
  c.setGitHub({ ok: false, error: "Run gh auth login" });
  expect(t.screen()).toContain("GitHub    ✗ Run gh auth login");
  c.stop();
});

test("Space changes and saves a setting, staying in settings; Esc returns to the previous screen", async () => {
  const t = terminal();
  const a = actions(false);
  const c = new LauncherConsole("1.0", a, t.input, t.output);
  c.start();
  t.press("s");
  await settle();
  expect(t.screen()).toContain("› PR checkouts after sessions end   [discard]");
  expect(t.screen()).toContain("Space change");
  // Enter doesn't change a setting, or leave.
  t.press("return");
  await settle();
  expect(a.saved).toEqual([]);
  expect(t.screen()).toContain("[discard]");
  t.press("space");
  await settle();
  expect(a.saved).toEqual([true]);
  expect(t.screen()).toContain("[keep]");
  expect(t.screen()).toContain("Saved: keep PR checkouts");
  t.press("space");
  await settle();
  expect(a.saved).toEqual([true, false]);
  t.press("escape");
  await settle();
  expect(t.screen()).toContain("Browser");
  expect(t.screen()).toContain("Settings  discard PR checkouts");
  c.stop();
});

test("colors what each line means, and none with NO_COLOR", () => {
  const draw = (env: NodeJS.ProcessEnv) => {
    const t = terminal();
    const c = new LauncherConsole("1.0", actions(), t.input, t.output, env);
    c.start();
    c.setGitHub({ ok: false, error: "Run gh auth login" });
    c.log("✓ Writing the guide (guide-1)");
    c.stop();
    return t.written();
  };
  const colored = draw({});
  expect(colored).toContain("\x1b[31m✗ Run gh auth login\x1b[0m");
  expect(colored).toContain("\x1b[32m✓ Writing the guide (guide-1)\x1b[0m");
  expect(colored).toContain("\x1b[1;36mCode Guide 1.0\x1b[0m");
  // Only leaving the screen resets attributes; nothing drawn is colored.
  const plain = draw({ NO_COLOR: "1" });
  expect(plain.endsWith("\x1b[0m\x1b[?25h\x1b[?1049l")).toBe(true);
  expect(plain.slice(0, -"\x1b[0m\x1b[?25h\x1b[?1049l".length)).not.toMatch(/\x1b\[[\d;]+m/);
});

test("clipping counts only visible text, not color codes", () => {
  const t = terminal();
  t.output.columns = 30;
  const c = new LauncherConsole("1.0", actions(), t.input, t.output);
  c.start();
  c.setGitHub({ ok: true, login: "a-very-long-login-name", host: "github.com" });
  const line = t
    .screen()
    .split("\n")
    .find((l) => l.startsWith("GitHub"))!;
  expect(line).toBe("GitHub    ✓ a-very-long-logi…");
  c.stop();
});

test("history shows each session and whether its checkout is still there", async () => {
  const t = terminal();
  const at = new Date(2026, 9, 15, 9, 30).toISOString();
  const past: HistoryItem[] = [
    {
      id: "a",
      startedAt: at,
      endedAt: at,
      mode: "pr",
      label: "acme/app#7",
      checkout: "/tmp/cg-1",
      kept: true,
      running: false,
      exists: true,
    },
    {
      id: "b",
      startedAt: at,
      endedAt: at,
      mode: "pr",
      label: "acme/app#8",
      checkout: "/tmp/cg-2",
      kept: false,
      running: false,
      exists: false,
    },
    { id: "c", startedAt: at, mode: "local", label: "/work/app", checkout: "/work/app", running: true, exists: true },
  ];
  const c = new LauncherConsole("1.0", actions(false, past), t.input, t.output);
  c.start();
  t.press("h");
  await settle();
  const screen = t.screen();
  expect(screen).toContain("acme/app#7  checkout kept · still there");
  expect(screen).toContain("/tmp/cg-1");
  expect(screen).toContain("acme/app#8  checkout discarded");
  expect(screen).toContain("/work/app  running");
  t.press("escape");
  expect(t.screen()).toContain("Browser");
  c.stop();
});

test("Esc and Back leave settings unchanged", async () => {
  const t = terminal();
  const a = actions();
  const c = new LauncherConsole("1.0", a, t.input, t.output);
  c.start();
  t.press("s");
  await settle();
  t.press("escape");
  await settle();
  expect(t.screen()).toContain("Browser");
  t.press("s");
  await settle();
  t.press("down");
  await settle();
  expect(t.screen()).toContain("› Back");
  t.press("return");
  await settle();
  expect(t.screen()).toContain("Browser");
  expect(a.saved).toEqual([]);
  c.stop();
});

test("keys open the browser, end the session, and quit", async () => {
  const t = terminal();
  const a = actions();
  const c = new LauncherConsole("1.0", a, t.input, t.output);
  c.start();
  t.press("e");
  expect(a.endSession).not.toHaveBeenCalled();
  c.setSession({ url: "u", label: "l" });
  t.press("e");
  expect(a.endSession).toHaveBeenCalledOnce();
  await settle();
  t.press("o");
  expect(a.openBrowser).toHaveBeenCalledOnce();
  t.press("c", { ctrl: true });
  t.press("q");
  expect(a.quit).toHaveBeenCalledOnce();
  c.stop();
});

test("without a terminal it prints lines and never touches the screen or stdin", () => {
  const t = terminal({ tty: false });
  const c = new LauncherConsole("1.0", actions(), t.input, t.output);
  c.start();
  c.setUrl("http://localhost:4646");
  c.setGitHub({ ok: true, login: "reader", host: "github.com" });
  c.log("hello \x1b[2Jworld");
  c.stop();
  expect(t.written()).toBe("Code Guide at http://localhost:4646\nGitHub  ✓ reader on github.com\nhello  world\n");
  expect(t.input.setRawMode).not.toHaveBeenCalled();
});
