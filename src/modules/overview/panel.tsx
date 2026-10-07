import { useEffect, useState } from "react";
import { RichText } from "@/components/RichText";
import type { PanelProps } from "@/lib/panels";
import { cn } from "@/lib/utils";
import type { Overview } from "./module";

/** The Overview module: a short intro to the subject, and the pull request's own description when it has one. */
export default function OverviewPanel({ job }: PanelProps) {
  const [data, setData] = useState<Overview>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<"summary" | "pr">("summary");
  useEffect(() => {
    if (!job) return;
    let current = true;
    fetch(`/api/results/${encodeURIComponent(job)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then(
        (d: Overview) => current && setData(d),
        (e: Error) => current && setError(e.message),
      );
    return () => {
      current = false;
    };
  }, [job]);

  if (error) return <p className="m-auto p-6 text-[13px] text-fg-2">{error}</p>;
  if (!data) return <p className="m-auto p-6 text-[13px] text-fg-2">Loading…</p>;
  const pr = data.pullRequest;
  const shown = pr ? tab : "summary";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pr && (
        <div role="tablist" className="flex h-8 flex-none items-end gap-1 border-b border-border px-3">
          <Tab selected={shown === "summary"} onClick={() => setTab("summary")}>
            Summary
          </Tab>
          <Tab selected={shown === "pr"} onClick={() => setTab("pr")}>
            Pull request #{pr.number}
          </Tab>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-[680px]">
          {shown === "summary" ? (
            <RichText text={data.summary} />
          ) : (
            <div className="flex flex-col gap-3">
              <a
                href={pr!.url}
                target="_blank"
                rel="noreferrer"
                className="text-[17px] leading-tight font-semibold hover:underline"
              >
                {pr!.title}
              </a>
              {pr!.body.trim() ? (
                <RichText text={pr!.body} />
              ) : (
                <p className="text-[13px] text-fg-3">No description.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tab({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "-mb-px h-7 border px-2.5 text-xs",
        selected
          ? "border-border border-b-surface bg-surface font-semibold"
          : "border-transparent text-fg-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
