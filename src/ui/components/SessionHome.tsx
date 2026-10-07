import { sessionChannel, useSession } from "@/lib/session";
import { Workspace } from "@/workspace/Workspace";
import { Message } from "./GuideView";
import { SubjectPicker } from "./SubjectPicker";

/** The session: the subject picker until it has a subject, then the workspace. */
export function SessionHome() {
  const { status, state, modules, error, fatal } = useSession();
  if (!state) return <Message title={status === "closed" ? "Not connected" : "Connecting…"}>{error}</Message>;
  if (!state.subject) return <SubjectPicker />;
  return (
    // Keyed by session: a new session loads its own layout, so its job ids don't meet the last one's.
    <Workspace
      key={state.id}
      state={state}
      modules={modules}
      channel={sessionChannel()}
      problem={!fatal && status !== "open" ? "Reconnecting to Code Guide…" : error}
    />
  );
}
