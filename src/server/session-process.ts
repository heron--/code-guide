import { fork, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Subject } from "../shared/protocol.js";
import type { Settings } from "../shared/settings.js";

export type SessionStart = {
  repo: string;
  subject: Subject;
  managed: boolean;
  launcherUrl: string;
  flags: Pick<Settings, "harness" | "model" | "reviewModel">;
};

/** Where a session process's console goes: log lines (its output and job results) and its live block. */
export type SessionOutput = { log(line: string): void; live(lines: string[]): void };

/**
 * One child per launcher. Readiness means its subject is accepted and its HTTP server is listening. Its output
 * never reaches the terminal directly; the launcher's console shows it.
 */
export class SessionProcess {
  readonly child: ChildProcess;
  readonly ready: Promise<string>;
  readonly stopped: Promise<void>;
  /** The session's id, once it's ready. */
  id?: string;

  constructor(entry: string, start: SessionStart, output: SessionOutput) {
    this.child = fork(entry, ["--session-process"], { cwd: start.repo, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let error = "";
    if (this.child.stdout) createInterface({ input: this.child.stdout }).on("line", (l) => output.log(l));
    if (this.child.stderr)
      createInterface({ input: this.child.stderr }).on("line", (l) => {
        error = `${error}\n${l}`.slice(-4000);
        output.log(l);
      });
    this.stopped = new Promise((resolve) => this.child.once("close", () => resolve()));
    this.child.on("message", (m) => {
      if (typeof m !== "object" || !m) return;
      if ("log" in m && typeof m.log === "string") output.log(m.log);
      if ("live" in m && Array.isArray(m.live)) output.live(m.live.filter((l): l is string => typeof l === "string"));
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Session startup timed out"));
        this.child.kill("SIGTERM");
      }, 120_000);
      const done = () => clearTimeout(timer);
      this.child.once("error", (e) => {
        done();
        reject(e);
      });
      this.child.once("close", () => {
        done();
        reject(new Error(error.trim() || "Session process stopped before it was ready"));
      });
      this.child.on("message", (message) => {
        if (typeof message === "object" && message && "url" in message && typeof message.url === "string") {
          if ("session" in message && typeof message.session === "string") this.id = message.session;
          done();
          resolve(message.url);
        }
      });
      this.child.send(start, (e) => {
        if (e) {
          done();
          reject(e);
        }
      });
    });
  }

  /** Asks the session to shut down, and kills it if it hasn't within a few seconds. */
  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return this.stopped;
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 5_000);
    await this.stopped;
    clearTimeout(timer);
  }
}
