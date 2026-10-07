import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import {
  PROTOCOL_VERSION,
  sessionEventSchema,
  type EventPayload,
  type EventType,
  type SessionEvent,
} from "../shared/protocol.js";
import { emptyState, reduce, type SessionState } from "../shared/state.js";

/** Where a repository's sessions live. Code Guide never edits .gitignore; that's the user's call. */
export const sessionsDir = (repo: string) => join(repo, ".code-guide", "sessions");

function newId(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

/**
 * One run of Code Guide on one subject. Its `events.jsonl` is the only record of what happened: the state
 * is whatever replaying it gives. Finished results are files beside the log, named by their events.
 */
export class Session {
  private events: SessionEvent[] = [];
  private listeners = new Set<(e: SessionEvent) => void>();
  state: SessionState;

  private constructor(
    readonly id: string,
    readonly dir: string,
  ) {
    this.state = emptyState(id);
  }

  private get log() {
    return join(this.dir, "events.jsonl");
  }

  static async create(repo: string): Promise<Session> {
    const id = newId();
    const s = new Session(id, join(sessionsDir(repo), id));
    await mkdir(join(s.dir, "results"), { recursive: true });
    s.append("session.started", { repo });
    return s;
  }

  /** Rebuild a session from its log, e.g. after the server restarts. */
  static async open(dir: string): Promise<Session> {
    const s = new Session(basename(dir), dir);
    const lines = (await readFile(s.log, "utf8")).split("\n").filter(Boolean);
    lines.forEach((line, i) => {
      let e: SessionEvent;
      try {
        e = sessionEventSchema.parse(JSON.parse(line));
      } catch (err) {
        throw new Error(`${s.log}:${i + 1}: ${(err as Error).message}`);
      }
      s.events.push(e);
      s.state = reduce(s.state, e);
    });
    return s;
  }

  /** Record an event, then apply it and send it to every listener. */
  append<T extends EventType>(type: T, payload: EventPayload<T>): SessionEvent {
    const e = {
      v: PROTOCOL_VERSION,
      seq: this.state.seq + 1,
      at: new Date().toISOString(),
      session: this.id,
      type,
      payload,
    } as SessionEvent;
    // Synchronous, so the log's order is the order events happened in.
    appendFileSync(this.log, JSON.stringify(e) + "\n");
    this.events.push(e);
    this.state = reduce(this.state, e);
    for (const l of this.listeners) l(e);
    return e;
  }

  /** Events after `seq`, oldest first. */
  eventsAfter(seq: number): SessionEvent[] {
    return this.events.slice(Math.max(0, seq));
  }

  /** Listen for new events. Returns a function that stops listening. */
  subscribe(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Store a finished result and return its path relative to the session directory. */
  async writeResult(name: string, data: unknown): Promise<string> {
    const rel = `results/${name}.json`;
    await writeFile(this.resolve(rel), JSON.stringify(data, null, 2) + "\n");
    return rel;
  }

  async readResult(rel: string): Promise<unknown> {
    return JSON.parse(await readFile(this.resolve(rel), "utf8"));
  }

  private resolve(rel: string): string {
    const abs = resolve(this.dir, rel);
    if (!abs.startsWith(resolve(this.dir) + sep)) throw new Error(`${rel} is outside the session`);
    return abs;
  }
}
