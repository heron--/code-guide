import type { Subject } from "../shared/protocol.js";
import { run } from "./run.js";
import type { Session } from "./session.js";
import { pullRequestFor } from "./subjects.js";

/** How often to ask GitHub about the subject's pull request. */
export const WATCH_EVERY = 60_000;

/** The pull request a change comes from, with its latest commit when the subject is the pull request itself. */
async function remoteOf(repo: string, s: Subject) {
  if (s.type !== "change") return undefined;
  if (!s.pr) {
    const pr = await pullRequestFor(repo, s);
    return pr && { number: pr.number, url: pr.url, title: pr.title };
  }
  const out = await run("gh", ["pr", "view", String(s.pr), "--json", "headRefOid,url,title"], { cwd: repo }).catch(
    () => undefined,
  );
  if (!out) return undefined;
  const { headRefOid, url, title } = JSON.parse(out) as { headRefOid: string; url: string; title: string };
  return { number: s.pr, url, title, head: headRefOid };
}

/**
 * Keeps `subject.remote` current: once a change subject is chosen, and every `every` ms after. Best effort:
 * without `gh`, or offline, nothing is reported. Returns a function that stops.
 */
export function watchPullRequest(session: Session, every = WATCH_EVERY): () => void {
  let last = "";
  let checking = false;
  const check = async () => {
    const s = session.state.subject?.subject;
    if (!s || checking) return;
    checking = true;
    try {
      const remote = await remoteOf(session.state.repo!, s);
      const key = JSON.stringify(remote ?? null);
      if (remote && key !== last) session.append("subject.remote", remote);
      last = key;
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(check, every);
  timer.unref();
  const stop = session.subscribe((e) => e.type === "session.subject" && void check());
  return () => {
    clearInterval(timer);
    stop();
  };
}
