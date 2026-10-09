import { latestDone, unavailable } from "../shared/modules.js";
import type { Subject } from "../shared/protocol.js";
import { hasNewCommits } from "../shared/state.js";
import { moduleInfo, type Module } from "../modules/types.js";
import type { RequestHandler } from "./channel.js";
import type { Chat } from "./chat.js";
import { revParse } from "./git.js";
import type { JobRunner } from "./jobs.js";
import type { Session } from "./session.js";
import { prepareChange, preparePullRequest } from "./subjects.js";

/** How a subject reads in the status bar, e.g. "feat/retry-policy vs main". */
export function subjectLabel(s: Subject): string {
  switch (s.type) {
    case "change":
      return s.pr ? `#${s.pr} vs ${s.base}` : `${s.head ?? "working tree"} vs ${s.base}`;
    case "path":
      return s.path;
    case "question":
      return s.question;
  }
}

/** Turns the browser's requests into jobs and events. Modules are looked up by name; none is special. */
export function requestHandler(session: Session, runner: JobRunner, modules: Module[], chat?: Chat): RequestHandler {
  return async (req) => {
    switch (req.type) {
      case "subject.choose":
        if (session.state.subject) throw new Error("This session already has a subject");
        const subject =
          req.subject.type !== "change"
            ? req.subject
            : req.subject.pr
              ? await preparePullRequest(session.state.repo!, req.subject)
              : await prepareChange(session.state.repo!, req.subject);
        // A ref that doesn't resolve (a typo, or HEAD in a repository with no commits) would fail every job.
        if (subject.type === "change")
          for (const ref of [subject.base, subject.head])
            if (ref && !(await revParse(session.state.repo!, ref))) throw new Error(`unknown ref "${ref}"`);
        if (session.state.subject) throw new Error("This session already has a subject");
        session.append("session.subject", { subject, label: subjectLabel(subject) });
        for (const m of modules) if (m.job && m.startsWithSession) runner.start(m.job, m.name);
        return;
      case "subject.update": {
        const current = session.state.subject?.subject;
        if (current?.type !== "change" || !hasNewCommits(session.state)) throw new Error("No new commits to update to");
        const subject = await preparePullRequest(session.state.repo!, { ...current, head: undefined });
        // The old head's jobs would finish with results about code the session no longer shows. A job finishing
        // meanwhile can start a follow-up, so keep going until none is left.
        const active = () =>
          session.state.jobOrder.find((id) => ["queued", "running"].includes(session.state.jobs[id].status));
        for (let id = active(); id; id = active()) await runner.cancel(id);
        session.append("session.subject", { subject, label: subjectLabel(subject) });
        // Every module that has run starts over. One that reads another's result (a quiz reads the guide) waits
        // for the reader, so it isn't built from the old guide.
        const ran = new Set(session.state.jobOrder.map((id) => session.state.jobs[id].module));
        for (const m of modules) if (m.job && !m.results?.length && ran.has(m.name)) runner.start(m.job, m.name);
        return;
      }
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
        if (req.pick !== undefined) {
          // The reader picked an option (a scenario) from the module's latest result.
          const from = latestDone(session.state, m.job.kind);
          if (!m.pick || !from) throw new Error(`${m.label} has nothing to pick from`);
          runner.start(m.pick, m.name, [from], req.pick);
          return;
        }
        runner.start(m.job, m.name, [
          ...(m.results ?? []).map((kind) => latestDone(session.state, kind)!),
          ...(m.reads ?? []).flatMap((kind) => latestDone(session.state, kind) ?? []),
        ]);
        return;
      }
      case "job.cancel":
        return runner.cancel(req.job);
      case "chat.send":
        if (!chat) throw new Error("Chat isn't available");
        return chat.send(req.text, req.context ?? []);
    }
  };
}

/**
 * A question is labelled with its own text, which is often too long for the status bar. Once a guide answers it,
 * the guide's title (a short name for the question) labels it instead. Returns a function that stops.
 */
export function labelQuestions(session: Session, runner: Pick<JobRunner, "onFinished">): () => void {
  return runner.onFinished((id, result) => {
    const title = (result as { title?: unknown } | undefined)?.title;
    const { subject } = session.state;
    if (session.state.jobs[id]?.kind !== "guide" || subject?.subject.type !== "question") return;
    if (typeof title === "string" && title.trim() && title !== subject.label)
      session.append("session.label", { label: title.trim() });
  });
}

/** Starts each module's follow-up jobs as its jobs finish. Returns a function that stops. */
export function followUps(session: Session, runner: JobRunner, modules: Module[]): () => void {
  return runner.onFinished((id, result) => {
    const job = session.state.jobs[id];
    const m = modules.find((m) => m.name === job.module);
    const next = m?.next?.({ job: id, kind: job.kind, result }, session.state);
    if (next) runner.start(next.job, m!.name, next.inputs);
  });
}
