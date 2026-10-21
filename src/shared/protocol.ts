import { z } from "zod";
import type { ModuleInfo } from "./modules.js";
import type { ViewSettings } from "./settings.js";

/**
 * The event protocol between the Code Guide server and the browser. See docs/protocol.md.
 *
 * The server is the source of truth. Everything that happens in a session is an event, appended to the
 * session's log and streamed to every connected tab. The browser never changes state itself: it sends a
 * request, and renders whatever events come back.
 */
export const PROTOCOL_VERSION = 5;

// ---- Shared payload shapes ----

/** What a session is about. */
export const subjectSchema = z.discriminatedUnion("type", [
  /** From the merge-base of `base` and `head` to `head`; no `head` means the working tree. */
  z.object({
    type: z.literal("change"),
    base: z.string().min(1),
    head: z.string().min(1).optional(),
    /** A pull request number, when the change came from one. */
    pr: z.number().int().positive().optional(),
    /** The reader's question about this change, when they want a more focused answer. */
    question: z.string().min(1).optional(),
  }),
  /** A directory, package or service, relative to the repository root. */
  z.object({ type: z.literal("path"), path: z.string().min(1) }),
  z.object({ type: z.literal("question"), question: z.string().min(1) }),
]);

const problemSchema = z.object({
  level: z.enum(["error", "warning"]),
  where: z.string(),
  message: z.string(),
});

/** What a chat message is about, besides its text. */
export const chatContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chapter"), job: z.string(), chapter: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal("prose"),
    job: z.string(),
    chapter: z.number().int().nonnegative(),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal("code"),
    path: z.string().min(1),
    start: z.number().int().positive(),
    end: z.number().int().positive(),
    /** Lines numbered on the change's base side: removed lines, or a deleted file. */
    side: z.literal("old").optional(),
  }),
  /** One step of a finished trace, by its index. */
  z.object({ kind: z.literal("step"), job: z.string(), step: z.number().int().nonnegative() }),
]);

// ---- Server → browser ----

/** Payload schema for each event type. */
export const eventPayloads = {
  /** First event of every session. */
  "session.started": z.object({ repo: z.string() }),
  "session.subject": z.object({ subject: subjectSchema, label: z.string() }),
  /** A better label for the subject, e.g. a question's guide title in place of the whole question. */
  "session.label": z.object({ label: z.string() }),
  "harness.status": z.object({
    harness: z.string(),
    model: z.string(),
    state: z.enum(["starting", "ready", "unavailable"]),
    message: z.string().optional(),
  }),
  /**
   * The pull request a change subject comes from, as GitHub has it now. `head` (its latest commit) is watched only
   * when the subject is the pull request itself; when it differs from the subject's, the reader can update.
   */
  "subject.remote": z.object({
    number: z.number().int().positive(),
    url: z.string(),
    title: z.string().optional(),
    head: z.string().optional(),
  }),

  /** A job was asked for. It starts when a slot under the concurrency limit is free. */
  "job.queued": z.object({
    job: z.string(),
    kind: z.string(),
    /** What it does, as the reader sees it, e.g. "Reviewing the guide". */
    label: z.string().optional(),
    module: z.string(),
    /** Finished results this job reads, by the job that produced them. */
    inputs: z.array(z.string()),
    /** The option the reader picked from its first input, e.g. the scenario a trace follows. */
    pick: z.number().int().nonnegative().optional(),
  }),
  "job.started": z.object({ job: z.string() }),
  /**
   * What the agent is doing, e.g. "Reading parsing.go". Never a partial result. A job that writes its result in
   * parts (a trace's steps) also says how many it has written: `written`, never what they say.
   */
  "job.progress": z.object({
    job: z.string(),
    activity: z.string(),
    written: z.number().int().nonnegative().optional(),
  }),
  /** The agent submitted a result. Errors go back to the agent; the job continues until one is accepted. */
  "job.submitted": z.object({
    job: z.string(),
    attempt: z.number().int().positive(),
    accepted: z.boolean(),
    problems: z.array(problemSchema),
  }),
  /** `result` is a file in the session directory, e.g. "results/guide-1.json". */
  "job.finished": z.object({ job: z.string(), result: z.string(), warnings: z.array(problemSchema) }),
  "job.failed": z.object({ job: z.string(), error: z.string(), problems: z.array(problemSchema) }),
  "job.cancelled": z.object({ job: z.string() }),

  /** A message from the reader, echoed so every tab shows it. */
  "chat.sent": z.object({ message: z.string(), text: z.string(), context: z.array(chatContextSchema) }),
  /** A reply started streaming. */
  "chat.started": z.object({ message: z.string(), replyTo: z.string() }),
  "chat.delta": z.object({ message: z.string(), text: z.string() }),
  "chat.finished": z.object({ message: z.string() }),
  "chat.failed": z.object({ message: z.string(), error: z.string() }),
} as const;

export type EventType = keyof typeof eventPayloads;
export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloads)[T]>;

/** Every event in a session's log, and every event the server sends. */
export type SessionEvent = {
  [T in EventType]: {
    v: typeof PROTOCOL_VERSION;
    /** 1, 2, 3… within a session. The browser resumes from the last one it saw. */
    seq: number;
    /** ISO 8601 */
    at: string;
    session: string;
    type: T;
    payload: EventPayload<T>;
  };
}[EventType];

export type EventOf<T extends EventType> = Extract<SessionEvent, { type: T }>;

const envelope = {
  v: z.literal(PROTOCOL_VERSION),
  seq: z.number().int().positive(),
  at: z.string(),
  session: z.string(),
};

export const sessionEventSchema = z.discriminatedUnion(
  "type",
  Object.entries(eventPayloads).map(([type, payload]) =>
    z.object({ ...envelope, type: z.literal(type), payload }),
  ) as unknown as [z.ZodObject, ...z.ZodObject[]],
) as unknown as z.ZodType<SessionEvent>;

// ---- Browser → server ----

export const requestSchema = z.discriminatedUnion("type", [
  /**
   * First message on every connection. A tab that has seen events sends its session and the last seq it saw;
   * if the server is on another session (it restarted), the tab gets that session from the start instead.
   */
  z.object({
    type: z.literal("hello"),
    v: z.number(),
    session: z.string().optional(),
    after: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal("subject.choose"), subject: subjectSchema }),
  /** Move a pull request subject to the pull request's latest commit, and run its modules again. */
  z.object({ type: z.literal("subject.update") }),
  /**
   * Start a job for a module. `retry` names a failed job to run again. `pick` starts the module's job for an option
   * the reader picked from its latest result, e.g. the scenario to trace.
   */
  z.object({
    type: z.literal("job.start"),
    module: z.string(),
    retry: z.string().optional(),
    pick: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal("job.cancel"), job: z.string() }),
  z.object({ type: z.literal("chat.send"), text: z.string().min(1), context: z.array(chatContextSchema).default([]) }),
]);

export type Request = z.input<typeof requestSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type ChatContext = z.infer<typeof chatContextSchema>;

/** Frames the server sends that aren't session events, and so aren't logged or replayed. */
export type Notice =
  /** Reply to "hello", before any replayed events. */
  | { type: "welcome"; v: typeof PROTOCOL_VERSION; session: string; modules: ModuleInfo[]; view?: ViewSettings }
  /** A request was refused, or the browser speaks another protocol version. */
  | { type: "error"; message: string; fatal: boolean };

export type ServerFrame = SessionEvent | Notice;
