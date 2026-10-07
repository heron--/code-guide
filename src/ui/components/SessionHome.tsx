import { sessionChannel, useSession } from "@/lib/session";
import { Workspace } from "@/workspace/Workspace";
import { SubjectPicker } from "./SubjectPicker";

/** The session: the subject picker until it has a subject, then the workspace. */
export function SessionHome() {
  const { status, state, modules, error } = useSession();
  if (!state) return <Message title={status === "closed" ? "Not connected" : "Connecting…"}>{error}</Message>;
  if (!state.subject) return <SubjectPicker />;
  return <Workspace state={state} modules={modules} channel={sessionChannel()} />;
}

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-8 py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-3 text-fg-2">{children}</div>
    </div>
  );
}
