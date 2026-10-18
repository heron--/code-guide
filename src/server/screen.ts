import { emitKeypressEvents } from "node:readline";
import type { GitHubStatus, HistoryItem } from "../shared/launcher.js";
import { clipLine, printable, widthOf } from "./terminal.js";

type Key = { name?: string; ctrl?: boolean; sequence?: string };

export type ScreenInput = {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(raw: boolean): unknown;
  on(event: "keypress", fn: (text: string, key: Key) => void): unknown;
  off(event: "keypress", fn: (text: string, key: Key) => void): unknown;
  resume(): unknown;
  pause(): unknown;
};

export type ScreenOutput = {
  write(s: string): unknown;
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  hasColors?(): boolean;
  on?(event: "resize", fn: () => void): unknown;
  off?(event: "resize", fn: () => void): unknown;
};

export type ConsoleActions = {
  keepClones(): Promise<boolean>;
  setKeepClones(keep: boolean): Promise<void>;
  history(): Promise<HistoryItem[]>;
  /** Opens the browser on the running session, or on selection when none is running. */
  openBrowser(): void;
  endSession(): Promise<void>;
  quit(): void;
};

export type ConsoleSession = { url: string; label: string };

type View = "home" | "settings" | "history";
type Style = "title" | "label" | "ok" | "error" | "warn" | "accent" | "key" | "selected";
/** Part of a line: plain text, or text in a style. */
type Span = string | { text: string; style: Style };
type Line = Span[];

const SGR: Record<Style, string> = {
  title: "1;36",
  label: "2",
  ok: "32",
  error: "31",
  warn: "33",
  accent: "36",
  key: "1",
  selected: "7",
};

/** Enter the alternate screen and hide the cursor; leaving restores the screen, the cursor and its position. */
const ENTER = "\x1b[?1049h\x1b[?25l";
const LEAVE = "\x1b[0m\x1b[?25h\x1b[?1049l";
const LOG_LINES = 200;

const span = (text: string, style?: Style): Span => (style ? { text, style } : text);
const field = (label: string, ...value: Span[]): Line => [span(label.padEnd(10), "label"), ...value];

/** A log line's color: what finished green, what failed red, the rest plain. */
function logStyle(line: string): Style | undefined {
  if (line.startsWith("✓") || line.startsWith("Kept") || line.startsWith("Saved")) return "ok";
  if (line.startsWith("✗") || /\b(failed|couldn't|error)\b/i.test(line)) return "error";
  return undefined;
}

/** A live line, e.g. "Guide  [███░░] Writing the guide": the module named, its bar colored, a failure red. */
function liveLine(line: string): Line {
  const m = line.match(/^(\S+\s+)(\[[█░]*\])?(.*)$/);
  if (!m) return [line];
  const failed = /^\s*failed:/.test(m[3]);
  return ["  ", span(m[1], "key"), ...(m[2] ? [span(m[2], "accent")] : []), failed ? span(m[3], "error") : m[3]];
}

/**
 * The launcher's console. On a terminal it takes over the screen: a home view with Code Guide's status and the
 * running session's progress, a settings view, and a session history. Leaving restores the terminal as it was.
 * Elsewhere (output piped to a file) it prints log lines and status changes instead, and reads no keys.
 */
export class LauncherConsole {
  private view: View = "home";
  private previous: View = "home";
  private url?: string;
  private github?: GitHubStatus;
  private session?: ConsoleSession;
  private live: string[] = [];
  private lines: string[] = [];
  private keep?: boolean;
  private notice?: string;
  private settingsError?: string;
  private past?: HistoryItem[] | { error: string };
  private selected = 0;
  private busy = false;
  private stopping = false;
  private active = false;
  private raw?: boolean;
  private readonly interactive: boolean;
  private readonly color: boolean;

  constructor(
    private readonly version: string,
    private readonly actions: ConsoleActions,
    private readonly input: ScreenInput = process.stdin,
    private readonly output: ScreenOutput = process.stdout,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.interactive = !!(input.isTTY && output.isTTY && input.setRawMode);
    // https://no-color.org
    this.color = !env.NO_COLOR && (output.hasColors?.() ?? true);
  }

  start() {
    if (!this.interactive || this.active) return;
    this.active = true;
    this.raw = this.input.isRaw;
    emitKeypressEvents(this.input as NodeJS.ReadableStream);
    this.input.setRawMode!(true);
    this.input.on("keypress", this.keypress);
    this.input.resume();
    this.output.on?.("resize", this.render);
    this.output.write(ENTER);
    void this.refreshSettings();
    this.render();
  }

  /** Restores the terminal exactly as `start` found it. Safe to call more than once, and from an exit handler. */
  stop() {
    if (!this.active) return;
    this.active = false;
    this.input.off("keypress", this.keypress);
    this.output.off?.("resize", this.render);
    this.input.setRawMode!(this.raw ?? false);
    this.input.pause();
    this.output.write(LEAVE);
  }

  setUrl(url: string) {
    this.url = url;
    if (!this.active) this.print(`Code Guide at ${url}`);
    this.render();
  }

  setGitHub(status: GitHubStatus) {
    if (JSON.stringify(status) === JSON.stringify(this.github)) return;
    this.github = status;
    if (!this.active) this.print(`GitHub  ${githubText(status)}`);
    this.render();
  }

  setSession(session: ConsoleSession | undefined) {
    this.session = session;
    if (!session) this.live = [];
    if (!this.active) this.print(session ? `Session  ${session.label} at ${session.url}` : "Session ended");
    this.render();
  }

  setLive(lines: string[]) {
    this.live = lines;
    this.render();
  }

  log(line: string) {
    this.lines = [...this.lines, ...printable(line).split("\n")].slice(-LOG_LINES);
    if (!this.active) this.print(line);
    this.render();
  }

  private print(line: string) {
    this.output.write(printable(line) + "\n");
  }

  private async refreshSettings() {
    try {
      this.keep = await this.actions.keepClones();
      this.settingsError = undefined;
    } catch (e) {
      this.settingsError = (e as Error).message;
    }
    this.render();
  }

  private async refreshHistory() {
    try {
      this.past = await this.actions.history();
    } catch (e) {
      this.past = { error: (e as Error).message };
    }
    this.render();
  }

  private go(view: View) {
    this.previous = this.view;
    this.view = view;
    this.selected = 0;
    this.render();
  }

  private back() {
    this.view = this.previous === this.view ? "home" : this.previous;
    this.previous = "home";
    this.render();
  }

  private keypress = (_text: string, key: Key) => {
    if (key.ctrl && key.name === "c") return this.quit();
    if (this.busy) return;
    if (this.view === "settings") return void this.settingsKey(key);
    if (this.view === "history") {
      if (key.name === "escape" || key.name === "return" || key.name === "h") return this.back();
      if (key.name === "q") return this.quit();
      return;
    }
    switch (key.name) {
      case "s":
        this.notice = undefined;
        this.settingsError = undefined;
        void this.refreshSettings();
        return this.go("settings");
      case "h":
        this.past = undefined;
        void this.refreshHistory();
        return this.go("history");
      case "o":
        return this.actions.openBrowser();
      case "e":
        if (!this.session) return;
        this.busy = true;
        this.notice = "Ending the session…";
        this.render();
        void this.actions
          .endSession()
          .then(
            () => undefined,
            (e) => `Couldn't end the session: ${(e as Error).message}`,
          )
          .then((notice) => {
            this.busy = false;
            this.notice = notice;
            this.render();
          });
        return;
      case "q":
        return this.quit();
    }
  };

  /** Settings: one row per setting, then Back. Space changes and saves the selected setting; Esc or Back leaves. */
  private async settingsKey(key: Key) {
    const rows = 2;
    if (key.name === "escape") return this.back();
    if (key.name === "up" || key.name === "k") this.selected = (this.selected + rows - 1) % rows;
    else if (key.name === "down" || key.name === "j" || key.name === "tab") this.selected = (this.selected + 1) % rows;
    else if (key.name === "return" && this.selected === 1) return this.back();
    else if (key.name === "space" && this.selected === 0 && this.keep !== undefined) {
      this.busy = true;
      this.settingsError = undefined;
      this.render();
      try {
        await this.actions.setKeepClones(!this.keep);
        this.keep = !this.keep;
        this.notice = `Saved: ${this.keep ? "keep" : "discard"} PR checkouts after sessions end.`;
      } catch (e) {
        this.settingsError = (e as Error).message;
      } finally {
        this.busy = false;
      }
    }
    this.render();
  }

  private quit() {
    if (this.stopping) return;
    this.stopping = true;
    this.notice = "Stopping Code Guide…";
    this.render();
    this.actions.quit();
  }

  private homeLines(): { body: Line[]; keys: [string, string][] } {
    const gh = this.github;
    const body: Line[] = [
      [span(`Code Guide ${this.version}`, "title")],
      [],
      field("Browser", this.url ? span(this.url, "accent") : "starting…"),
      field(
        "GitHub",
        !gh ? "checking…" : gh.ok ? span(`✓ ${gh.login} on ${gh.host}`, "ok") : span(`✗ ${gh.error}`, "error"),
      ),
      field(
        "Session",
        ...(this.session
          ? [span(this.session.label, "key"), " · ", span(this.session.url, "accent")]
          : [span("none · choose a subject in the browser", "label")]),
      ),
      field(
        "Settings",
        this.keep === undefined ? "…" : this.keep ? "keep" : "discard",
        " PR checkouts after sessions end",
      ),
    ];
    if (this.notice) body.push([], [span(this.notice, "warn")]);
    if (this.session && this.live.length) body.push([], [span("Progress", "title")], ...this.live.map(liveLine));
    body.push([], [span("Log", "title")]);
    const keys: [string, string][] = [
      ["s", "settings"],
      ["h", "history"],
      ["o", "open browser"],
      ...(this.session ? [["e", "end session"] as [string, string]] : []),
      ["q", "quit"],
    ];
    return { body, keys };
  }

  private settingsLines(): { body: Line[]; keys: [string, string][] } {
    const row = (i: number, ...spans: Span[]): Line =>
      this.selected === i
        ? [span(`› ${spans.map((s) => (typeof s === "string" ? s : s.text)).join("")}`, "selected")]
        : ["  ", ...spans];
    const keep = this.keep === undefined ? "…" : this.keep ? "keep" : "discard";
    const body: Line[] = [
      [span("Settings", "title")],
      [],
      row(0, "PR checkouts after sessions end   ", span(`[${keep}]`, "accent")),
      row(1, "Back"),
      [],
      [span("Saved in ~/.code-guide/settings.json.", "label")],
    ];
    if (this.busy) body.push([], [span("Saving…", "warn")]);
    else if (this.notice?.startsWith("Saved")) body.push([], [span(this.notice, "ok")]);
    if (this.settingsError) body.push([], [span(`Error: ${this.settingsError}`, "error")]);
    return {
      body,
      keys: [
        ["↑/↓", "select"],
        ["Space", "change"],
        ["Esc", "back"],
      ],
    };
  }

  private historyLines(): { body: Line[]; keys: [string, string][] } {
    const body: Line[] = [[span("Session history", "title")], []];
    const past = this.past;
    if (!past) body.push([span("Reading history…", "label")]);
    else if ("error" in past) body.push([span(`Error: ${past.error}`, "error")]);
    else if (!past.length) body.push([span("No sessions yet.", "label")]);
    else
      for (const h of past) {
        const status = historyStatus(h);
        body.push([
          span(new Date(h.startedAt).toLocaleString().padEnd(24), "label"),
          span(h.label, "key"),
          "  ",
          span(status.text, status.style),
        ]);
        if (h.mode === "pr" && h.exists) body.push([span(" ".repeat(24), "label"), span(h.checkout, "accent")]);
      }
    return { body, keys: [["Esc", "back"]] };
  }

  private render = () => {
    if (!this.active) return;
    // A terminal that reports no size (0) gets the conventional 80×24.
    const width = Math.max(10, (this.output.columns || 80) - 1);
    const height = Math.max(4, this.output.rows || 24);
    const { body, keys } =
      this.view === "home" ? this.homeLines() : this.view === "settings" ? this.settingsLines() : this.historyLines();
    // The log fills whatever rows the home view leaves, newest last; one row stays for the keys.
    const room = height - 1 - body.length;
    const log = this.view === "home" && room > 0 ? this.lines.slice(-room).map((l) => [span(l, logStyle(l))]) : [];
    const rows = [...body, ...log].slice(0, height - 1);
    while (rows.length < height - 1) rows.push([]);
    rows.push(
      keys.flatMap(([k, what], i): Span[] => [...(i ? [span(" · ", "label")] : []), span(k, "key"), ` ${what}`]),
    );
    this.output.write(rows.map((l, i) => `\x1b[${i + 1};1H${this.draw(l, width)}\x1b[K`).join(""));
  };

  /** A line's spans, cut to `width` columns, colored when the terminal has colors. */
  private draw(line: Line, width: number): string {
    let left = width;
    let out = "";
    for (const s of line) {
      if (left <= 0) break;
      const raw = printable(typeof s === "string" ? s : s.text);
      const text = clipLine(raw, left);
      left -= widthOf(text);
      const style = typeof s === "string" ? undefined : s.style;
      out += style && this.color ? `\x1b[${SGR[style]}m${text}\x1b[0m` : text;
      if (text !== raw) break;
    }
    return out;
  }
}

function githubText(status: GitHubStatus): string {
  return status.ok ? `✓ ${status.login} on ${status.host}` : `✗ ${status.error}`;
}

/** How a past session ended, and whether its checkout is still on disk. */
export function historyStatus(h: HistoryItem): { text: string; style: Style } {
  if (h.running) return { text: "running", style: "accent" };
  if (h.mode === "local")
    return h.endedAt ? { text: "ended", style: "label" } : { text: "ended unexpectedly", style: "warn" };
  if (!h.endedAt)
    return h.exists
      ? { text: "ended unexpectedly · checkout still there", style: "warn" }
      : { text: "ended unexpectedly · checkout gone", style: "label" };
  if (!h.kept) return { text: "checkout discarded", style: "label" };
  return h.exists
    ? { text: "checkout kept · still there", style: "ok" }
    : { text: "checkout kept · since removed", style: "label" };
}
