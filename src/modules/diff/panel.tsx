import { useEffect, useRef, useState } from "react";
import type { FileStatus, ResolvedFile } from "../../shared/guide";
import { ChangeCount, FileCard, LangTag, splitPath } from "@/code/FileCard";
import { initialVisible } from "@/code/excerpt";
import type { PanelProps } from "@/lib/panels";
import { cn } from "@/lib/utils";

type Changed = { path: string; additions: number; deletions: number; status: FileStatus };
const domId = (path: string) => `diff-${encodeURIComponent(path)}`;

/** The Diff module: the whole change in file order, like a pull request. Independent of the Guide. */
export default function DiffPanel({ state }: PanelProps) {
  const [changed, setChanged] = useState<Changed[]>();
  const [error, setError] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const subject = state.subject?.subject;

  useEffect(() => {
    fetch("/api/diff")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then(
        (d: { changed: Changed[] }) => setChanged(d.changed),
        (e: Error) => setError(e.message),
      );
  }, []);

  if (error) return <p className="m-auto p-6 text-[13px] text-fg-2">{error}</p>;
  if (!changed) return <p className="m-auto p-6 text-[13px] text-fg-2">Loading the change…</p>;

  const add = changed.reduce((n, f) => n + f.additions, 0);
  const del = changed.reduce((n, f) => n + f.deletions, 0);
  const jump = (path: string) => {
    const el = document.getElementById(domId(path));
    const p = scroller.current;
    if (el && p) p.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  };

  return (
    <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto bg-surface-4">
      <div className="flex items-center gap-2.5 px-3 pt-3 pb-2.5">
        <span className="text-[13px] font-semibold">
          {changed.length} file{changed.length === 1 ? "" : "s"} changed
        </span>
        <ChangeCount file={{ additions: add, deletions: del }} />
        <span className="flex-1" />
        {subject?.type === "change" && (
          <span className="truncate font-mono text-[11px] text-fg-3">
            {subject.pr ? `#${subject.pr}` : (subject.head ?? "working tree")} ← {subject.base}
          </span>
        )}
      </div>
      <nav aria-label="Changed files" className="mx-3 border border-b-0 border-border bg-surface">
        {changed.map((f) => {
          const { name, dir } = splitPath(f.path);
          return (
            <button
              key={f.path}
              onClick={() => jump(f.path)}
              className="flex h-[26px] w-full min-w-0 items-center gap-2 border-b border-border-subtle px-2.5 text-left hover:bg-surface-2"
            >
              <LangTag path={f.path} />
              <span className="min-w-0 truncate font-mono text-[11.5px]">
                <span className="text-fg-3">{dir}</span>
                <span
                  className={cn(f.status === "added" && "text-add", f.status === "deleted" && "text-del line-through")}
                >
                  {name}
                </span>
              </span>
              <span className="flex-1" />
              <ChangeCount file={f} />
            </button>
          );
        })}
      </nav>
      <div className="flex flex-col gap-3 p-3 pb-[40vh]">
        {changed.map((f) => (
          <DiffFile key={f.path} path={f.path} scroller={scroller} />
        ))}
      </div>
    </div>
  );
}

/** One file's diff, loaded when it first comes near the screen. */
function DiffFile({ path, scroller }: { path: string; scroller: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<ResolvedFile>();
  const [visible, setVisible] = useState<boolean[]>();
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    // The panel's scroller is the root: margins don't reach past a clipping ancestor that isn't.
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), {
      root: scroller.current,
      rootMargin: "800px",
    });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [scroller]);
  useEffect(() => {
    if (!near || file || failed) return;
    fetch(`/api/diff/file?path=${encodeURIComponent(path)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then(
        (f: ResolvedFile) => {
          setFile(f);
          setVisible(initialVisible(f));
        },
        // E.g. a working-tree file reverted since the list was made.
        (e: Error) => setFailed(e.message),
      );
  }, [near, file, failed, path]);

  return (
    <div ref={ref} id={domId(path)}>
      {file && visible ? (
        <FileCard
          id={`${domId(path)}-card`}
          file={file}
          visible={visible}
          onReveal={(from, to) => setVisible((v) => v && v.map((shown, i) => shown || (i >= from && i <= to)))}
        />
      ) : (
        <div className="flex h-8 items-center gap-2 border border-border bg-surface-3 px-2.5">
          <LangTag path={path} />
          <span className="font-mono text-xs text-fg-3">{path}</span>
          {failed && <span className="ml-auto text-[11.5px] text-del">{failed}</span>}
        </div>
      )}
    </div>
  );
}
