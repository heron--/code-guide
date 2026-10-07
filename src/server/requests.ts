import { latestFinished, unavailable } from "../shared/modules.js";
import type { Subject } from "../shared/protocol.js";
import { moduleInfo, type Module } from "../modules/types.js";
import type { RequestHandler } from "./channel.js";
import type { JobRunner } from "./jobs.js";
import type { Session } from "./session.js";

/** How a subject reads in the status bar, e.g. "feat/retry-policy vs main". */
export function subjectLabel(s: Subject): string {
  switch (s.type) {
    case "change":
      return `${s.pr ? `#${s.pr} · ` : ""}${s.head ?? "working tree"} vs ${s.base}`;
    case "path":
      return s.path;
    case "question":
      return s.question;
  }
}

/** Turns the browser's requests into jobs and events. Modules are looked up by name; none is special. */
export function requestHandler(session: Session, runner: JobRunner, modules: Module[]): RequestHandler {
  return async (req) => {
    switch (req.type) {
      case "subject.choose":
        if (session.state.subject) throw new Error("This session already has a subject");
        session.append("session.subject", { subject: req.subject, label: subjectLabel(req.subject) });
        return;
      case "job.start": {
        const m = modules.find((m) => m.name === req.module);
        if (!m) throw new Error(`No module named "${req.module}"`);
        if (!m.job) throw new Error(`${m.label} opens without a job`);
        if (req.retry) {
          runner.retry(req.retry);
          return;
        }
        const why = unavailable(moduleInfo(m), session.state);
        if (why) throw new Error(why);
        runner.start(
          m.job,
          m.name,
          (m.results ?? []).map((kind) => latestFinished(session.state, kind)!),
        );
        return;
      }
      case "job.cancel":
        return runner.cancel(req.job);
      case "chat.send":
        throw new Error("Chat isn't available yet");
    }
  };
}
