import type { ChatContext, EventPayload, SessionEvent, Subject } from "./protocol.js";

type Problem = EventPayload<"job.submitted">["problems"][number];

export type JobState = {
  id: string;
  kind: string;
  /** What it does, as the reader sees it, e.g. "Reviewing the guide". */
  label?: string;
  module: string;
  inputs: string[];
  status: "queued" | "running" | "finished" | "failed" | "cancelled";
  /** Latest progress, while running. */
  activity?: string;
  /** How many progress events it has reported: a rough measure of how far along it is. */
  steps: number;
  /** Submissions so far, accepted or not. */
  attempts: number;
  /** File in the session directory, once finished. */
  result?: string;
  warnings: Problem[];
  error?: string;
  problems: Problem[];
};

export type ChatMessage = {
  id: string;
  from: "reader" | "agent";
  text: string;
  context: ChatContext[];
  replyTo?: string;
  status: "streaming" | "done" | "failed";
  error?: string;
};

/** Everything the browser shows, rebuilt from the event log alone. */
export type SessionState = {
  id: string;
  /** Last event applied. */
  seq: number;
  repo?: string;
  subject?: { subject: Subject; label: string };
  harness?: EventPayload<"harness.status">;
  jobs: Record<string, JobState>;
  /** Job ids, oldest first. */
  jobOrder: string[];
  chat: ChatMessage[];
};

export function emptyState(id: string): SessionState {
  return { id, seq: 0, jobs: {}, jobOrder: [], chat: [] };
}

/** Apply one event. Pure: returns a new state and never mutates the old one. */
export function reduce(state: SessionState, e: SessionEvent): SessionState {
  const s: SessionState = { ...state, seq: e.seq };
  const job = (id: string, patch: Partial<JobState>) => {
    if (s.jobs[id]) s.jobs = { ...s.jobs, [id]: { ...s.jobs[id], ...patch } };
  };
  const message = (id: string, patch: (m: ChatMessage) => Partial<ChatMessage>) => {
    s.chat = s.chat.map((m) => (m.id === id ? { ...m, ...patch(m) } : m));
  };

  switch (e.type) {
    case "session.started":
      s.repo = e.payload.repo;
      break;
    case "session.subject":
      s.subject = e.payload;
      break;
    case "harness.status":
      s.harness = e.payload;
      break;

    case "job.queued": {
      const { job: id, ...rest } = e.payload;
      s.jobs = {
        ...s.jobs,
        [id]: { id, ...rest, status: "queued", steps: 0, attempts: 0, warnings: [], problems: [] },
      };
      s.jobOrder = [...s.jobOrder, id];
      break;
    }
    case "job.started":
      job(e.payload.job, { status: "running" });
      break;
    case "job.progress":
      job(e.payload.job, { activity: e.payload.activity, steps: (s.jobs[e.payload.job]?.steps ?? 0) + 1 });
      break;
    case "job.submitted":
      job(e.payload.job, { attempts: e.payload.attempt, problems: e.payload.problems });
      break;
    case "job.finished":
      job(e.payload.job, {
        status: "finished",
        activity: undefined,
        result: e.payload.result,
        warnings: e.payload.warnings,
        problems: [],
      });
      break;
    case "job.failed":
      job(e.payload.job, {
        status: "failed",
        activity: undefined,
        error: e.payload.error,
        problems: e.payload.problems,
      });
      break;
    case "job.cancelled":
      job(e.payload.job, { status: "cancelled", activity: undefined });
      break;

    case "chat.sent":
      s.chat = [
        ...s.chat,
        {
          id: e.payload.message,
          from: "reader",
          text: e.payload.text,
          context: e.payload.context,
          status: "done",
        },
      ];
      break;
    case "chat.started":
      s.chat = [
        ...s.chat,
        {
          id: e.payload.message,
          from: "agent",
          text: "",
          context: [],
          replyTo: e.payload.replyTo,
          status: "streaming",
        },
      ];
      break;
    case "chat.delta":
      message(e.payload.message, (m) => ({ text: m.text + e.payload.text }));
      break;
    case "chat.finished":
      message(e.payload.message, () => ({ status: "done" }));
      break;
    case "chat.failed":
      message(e.payload.message, () => ({ status: "failed", error: e.payload.error }));
      break;
  }
  return s;
}
