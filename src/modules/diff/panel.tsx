import { useEffect, useRef, useState } from "react";
import type { FileStatus, ResolvedFile } from "../../shared/guide";
import { ChangeCount, FileCard, LangTag, Reviewed, splitPath } from "@/code/FileCard";
import { indexRange, initialVisible } from "@/code/excerpt";
import type { PanelProps } from "@/lib/panels";
import { usePersistent } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useLineShower, type LinesTarget } from "@/workspace/actions";
import { useAskSelection } from "@/workspace/ask";

type Changed = { path: string; additions: number; deletions: number; status: FileStatus };
const domId = (path: string) => `diff-${encodeURIComponent(path)}`;

/** The Diff module: the whole change in file order, like a pull request. Independent of the Guide. */
export default function DiffPanel({ state }: PanelProps) {
  const [changed, setChanged] = useState<Changed[]>();
  const [error, setError] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Loaded files, so a selection in one can be asked about in Chat.
  const files = useRef(new Map<string, ResolvedFile>());
  const selecting = useAskSelection(root, { file: (path) => files.current.get(path) });
  const subject = state.subject?.subject;
  // Every line of every changed file, instead of just the hunks.
  const [full, setFull] = usePersistent(`cg:${state.id}:diff:full`, false);
  // A citation to a changed file: scroll to it, and the file marks its lines once loaded.
  const [target, setTarget] = useState<LinesTarget & { nonce: number }>();
  useLineShower("diff", {
    canShow: (path) => !!changed?.some((f) => f.path === path),
    show: (t) => setTarget({ ...t, nonce: Date.now() }),
  });
  useEffect(() => {
    if (target && changed) jump(target.path);
  }, [target, changed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Again when the subject moves to new commits.
  const head = subject?.type === "change" ? subject.head : undefined;
  useEffect(() => {
    files.current.clear();
    setError(undefined);
    // A reply for an earlier head that lands late must not replace this one's.
    let current = true;
    fetch("/api/diff")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then(
        (d: { changed: Changed[] }) => current && setChanged(d.changed),
        (e: Error) => current && setError(e.message),
      );
    return () => {
      current = false;
    };
  }, [head]);

  function jump(path: string) {
    const el = document.getElementById(domId(path));
    const p = scroller.current;
    if (el && p) p.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  }

  if (error) return <p className="m-auto p-6 text-[13px] text-fg-2">{error}</p>;
  if (!changed) return <p className="m-auto p-6 text-[13px] text-fg-2">Loading the change…</p>;

  const add = changed.reduce((n, f) => n + f.additions, 0);
  const del = changed.reduce((n, f) => n + f.deletions, 0);

  return (
    <div
      ref={root}
      tabIndex={-1}
      onMouseUp={selecting.onMouseUp}
      onKeyDown={(e) => selecting.onKey(e) && e.preventDefault()}
      onPointerDown={(e) =>
        !(e.target as HTMLElement).closest("button,input,a,label") && root.current?.focus({ preventScroll: true })
      }
      className="relative flex min-h-0 flex-1 flex-col outline-none"
    >
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto bg-surface-4">
        <div className="flex items-center gap-2.5 px-3 pt-3 pb-2.5">
          <span className="text-[13px] font-semibold">
            {changed.length} file{changed.length === 1 ? "" : "s"} changed
          </span>
          <ChangeCount file={{ additions: add, deletions: del }} />
          <span className="flex-1" />
          <Reviewed checked={full} onChange={setFull} label="Full diff" />
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
                    className={cn(
                      f.status === "added" && "text-add",
                      f.status === "deleted" && "text-del line-through",
                    )}
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
            <DiffFile
              key={`${head}:${f.path}`}
              path={f.path}
              full={full}
              onLoad={(f) => files.current.set(f.path, f)}
              scroller={scroller}
              target={target?.path === f.path ? target : undefined}
            />
          ))}
        </div>
      </div>
      {selecting.chip}
    </div>
  );
}

/** One file's diff, loaded when it first comes near the screen. */
function DiffFile({
  path,
  full,
  onLoad,
  scroller,
  target,
}: {
  onLoad: (f: ResolvedFile) => void;
  path: string;
  /** Show every line, loaded now rather than when the file nears the screen. */
  full: boolean;
  scroller: React.RefObject<HTMLDivElement | null>;
  target?: LinesTarget & { nonce: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<ResolvedFile>();
  const [visible, setVisible] = useState<boolean[]>();
  const [near, setNear] = useState(false);
  const [marked, setMarked] = useState<[number, number]>();

  useEffect(() => {
    if (target || full) setNear(true);
  }, [target, full]);
  useEffect(() => {
    // A citation in another file takes the mark with it.
    if (!target) return setMarked(undefined);
    if (!file) return;
    const ir = indexRange(file, { start: target.start, end: target.end });
    if (!ir) return;
    setVisible((v) => v && v.map((shown, i) => shown || (i >= ir[0] && i <= ir[1])));
    setMarked(ir);
    requestAnimationFrame(() =>
      ref.current?.querySelector(`[data-idx="${ir[0]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  }, [target, file]);
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
    // A reply that lands after this card is gone (the head moved on) must not register its file.
    let current = true;
    fetch(`/api/diff/file?path=${encodeURIComponent(path)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then(
        (f: ResolvedFile) => {
          if (!current) return;
          onLoad(f);
          setFile(f);
          setVisible(initialVisible(f));
        },
        // E.g. a working-tree file reverted since the list was made.
        (e: Error) => current && setFailed(e.message),
      );
    return () => {
      current = false;
    };
  }, [near, file, failed, path]);

  return (
    <div ref={ref} id={domId(path)}>
      {file && visible ? (
        <FileCard
          id={`${domId(path)}-card`}
          file={file}
          visible={full ? visible.map(() => true) : visible}
          marked={marked}
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
