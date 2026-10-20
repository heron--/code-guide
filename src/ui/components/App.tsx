import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { LauncherState } from "../../shared/launcher";
import { Launcher, launcherQueries, launcherRequest } from "./Launcher";
import { SessionHome } from "./SessionHome";

const queries = launcherQueries();

type Home = (LauncherState & { sessionUrl?: string }) | { mode: "session"; launcherUrl?: string };

/** No session channel is opened until a session process is serving this browser. */
export function App() {
  const [home, setHome] = useState<Home>();
  const [error, setError] = useState<string>();
  const refresh = () => {
    setError(undefined);
    return launcherRequest<Home>("launcher").then(setHome, (e) => setError(e.message));
  };
  useEffect(() => void refresh(), []);
  useEffect(() => {
    if (home?.mode !== "launcher" || !home.sessionUrl) return;
    const timer = setTimeout(refresh, 1500);
    return () => clearTimeout(timer);
  }, [home]);
  if (!home)
    return (
      <div className="p-8">
        {error ?? "Opening Code Guide…"}
        {error && <button onClick={refresh}>Retry</button>}
      </div>
    );
  if (home.mode === "launcher")
    return (
      <QueryClientProvider client={queries}>
        <Launcher initial={home} refresh={refresh} />
      </QueryClientProvider>
    );
  return (
    <div className="flex h-full flex-col">
      {home.launcherUrl && (
        <div className="flex items-center justify-end gap-3 border-b border-rule bg-surface-3 px-3 py-1 text-xs">
          {error && (
            <span role="alert" className="text-del">
              {error}
            </span>
          )}
          <button
            onClick={() => {
              void launcherRequest<{ url: string }>("end", {}).then(
                (result) => window.location.assign(result.url),
                (e) => setError(e.message),
              );
            }}
          >
            End session
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <SessionHome />
      </div>
    </div>
  );
}
