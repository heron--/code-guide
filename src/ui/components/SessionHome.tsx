import { useEffect } from "react";
import { sessionChannel, useSession } from "@/lib/session";
import { Workspace } from "@/workspace/Workspace";

/** The session's workspace. A session process chooses its subject before it serves the browser. */
export function SessionHome() {
  const { status, state, modules, view, error, fatal } = useSession();
  // "system" follows the OS; the tokens read data-theme otherwise.
  useEffect(() => {
    if (view.theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = view.theme;
  }, [view.theme]);
  if (!state) return <Message title={status === "closed" ? "Not connected" : "Connecting…"}>{error}</Message>;
  if (!state.subject) return <Message title="Starting the session…" />;
  return (
    // Keyed by session: a new session loads its own layout, so its job ids don't meet the last one's.
    <Workspace
      key={state.id}
      state={state}
      modules={modules}
      panels={view.modules}
      channel={sessionChannel()}
      problem={!fatal && status !== "open" ? "Reconnecting to Code Guide…" : error}
    />
  );
}

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-8 py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-3 text-fg-2">{children}</div>
    </div>
  );
}
