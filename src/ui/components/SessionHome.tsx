import { BookOpen } from "lucide-react";
import { latestDone } from "../../shared/modules";
import { href } from "@/lib/router";
import { useSession } from "@/lib/session";
import { Message } from "./GuideView";
import { SubjectPicker } from "./SubjectPicker";

/** The session at a glance, until the workspace (M8) replaces it: its subject, harness, and jobs. */
export function SessionHome() {
  const { status, state, error } = useSession();
  if (!state) return <Message title={status === "closed" ? "Not connected" : "Connecting…"}>{error}</Message>;
  if (!state.subject) return <SubjectPicker />;

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-tight">
        <BookOpen className="size-6" /> Code Guide
      </h1>
      <p className="mt-1 truncate font-mono text-sm text-muted-foreground">
        {state.repo} · {state.harness ? `${state.harness.harness} · ${state.harness.model}` : "no harness"}
      </p>
      {error && <p className="mt-4 text-del">{error}</p>}
      <p className="mt-6 text-[15px]">{state.subject.label}</p>
      <ul className="mt-6 space-y-2">
        {state.jobOrder.map((id) => {
          const job = state.jobs[id];
          return (
            <li key={id} className="rounded-lg border border-border bg-card px-4 py-3">
              <span className="font-mono text-sm">{id}</span>{" "}
              <span className="text-muted-foreground">{job.status}</span>
              {job.activity && <span className="ml-2 text-sm text-muted-foreground">· {job.activity}</span>}
              {job.error && <span className="ml-2 text-sm text-del">· {job.error}</span>}
              {id === latestDone(state, "guide") && (
                <a className="ml-2 underline" href={href({ page: "guide", id, tab: "guide", chapter: 0 })}>
                  Read
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
