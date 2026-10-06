import { useEffect, useRef, useState } from "react";
import type { ResolvedFile, ResolvedGuide } from "../../shared/guide";
import { api } from "@/lib/api";
import { initialVisible } from "@/lib/excerpt";
import { FileCard } from "./FileCard";
import { FileRow } from "./FileRow";

const CONCURRENCY = 4;

/** Every changed file in the change, regardless of chapters. */
export function DiffTab({
  data,
  reviewedFiles,
  setFileReviewed,
}: {
  data: ResolvedGuide;
  reviewedFiles: Set<string>;
  setFileReviewed: (path: string, v: boolean) => void;
}) {
  const changed = data.changed ?? [];
  const [files, setFiles] = useState<Record<string, ResolvedFile>>({});
  const [visible, setVisible] = useState<Record<string, boolean[]>>({});
  const pane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const queue = [...changed.map((c) => c.path)];
    const worker = async () => {
      for (let path = queue.shift(); path && !cancelled; path = queue.shift()) {
        const f =
          data.files[path]?.status !== "unchanged" && data.files[path]
            ? data.files[path]
            : await api.changedFile(data.id, path).catch(() => undefined);
        if (!f || cancelled) continue;
        setFiles((prev) => ({ ...prev, [path]: f }));
        setVisible((prev) => ({ ...prev, [path]: initialVisible(f) }));
      }
    };
    Array.from({ length: CONCURRENCY }, worker);
    return () => {
      cancelled = true;
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const domId = (path: string) => `diff-${path.replace(/[^\w-]/g, "_")}`;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-[clamp(280px,28vw,420px)] shrink-0 space-y-2 overflow-y-auto px-6 pb-16 pt-6">
        <p className="mb-3 text-sm text-muted-foreground">
          {changed.length} changed file{changed.length === 1 ? "" : "s"}
        </p>
        {changed.map((c) => (
          <FileRow
            key={c.path}
            {...c}
            reviewed={reviewedFiles.has(c.path)}
            onClick={() => {
              const el = document.getElementById(domId(c.path));
              const p = pane.current;
              if (el && p) p.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
            }}
          />
        ))}
      </aside>
      <div ref={pane} className="relative min-w-0 flex-1 overflow-y-auto pl-2 pr-6">
        <div className="space-y-4 pb-[40vh] pt-6">
          {changed.map((c) =>
            files[c.path] ? (
              <FileCard
                key={c.path}
                id={domId(c.path)}
                file={files[c.path]}
                visible={visible[c.path]}
                onReveal={(from, to) =>
                  setVisible((prev) => {
                    const next = [...prev[c.path]];
                    for (let i = from; i <= to; i++) next[i] = true;
                    return { ...prev, [c.path]: next };
                  })
                }
                reviewed={reviewedFiles.has(c.path)}
                onReviewed={(v) => setFileReviewed(c.path, v)}
              />
            ) : (
              <div
                key={c.path}
                id={domId(c.path)}
                className="h-12 animate-pulse rounded-xl border border-border bg-card"
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
