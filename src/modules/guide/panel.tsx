import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { parseRange, type Problem, type ResolvedGuide } from "../../shared/guide";
import { ChangeCount, FileCard, LangTag, Reviewed, splitPath } from "@/code/FileCard";
import { indexRange, initialVisible } from "@/code/excerpt";
import { api } from "@/lib/api";
import type { PanelProps } from "@/lib/panels";
import { usePersistent, usePersistentSet } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useLineShower } from "@/workspace/actions";
import { Icon } from "@/workspace/Icon";
import { Prose, type AnchorTarget } from "./Prose";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const pad = (n: number) => String(n).padStart(2, "0");
const fileDomId = (chapter: number, path: string) => `c${chapter}-${encodeURIComponent(path)}`;

/** Narrower than this, prose and file list stack above the code. */
const NARROW = 720;

type Loaded = ResolvedGuide | { problems: Problem[]; guide?: undefined };

/** The Guide module: one chapter at a time, prose beside the code it's about. */
export default function GuidePanel({ state, job }: PanelProps) {
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!job) return;
    setData(undefined);
    api.guide(job).then(setData, (e) => setError(e.message));
  }, [job]);

  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, []);

  // Marks and position are kept per session: every session has a guide-1.
  const key = `cc:${state.id}:${job}`;
  const [reviewedChapters, toggleChapter] = usePersistentSet(`${key}:chapters`);
  const [reviewedFiles, toggleFile] = usePersistentSet(`${key}:files`);
  const [chapter, setChapter] = usePersistent(`cg:${state.id}:${job}:chapter`, 0);

  let body;
  if (error) body = <Note title="Couldn't load this guide">{error}</Note>;
  else if (!data) body = <Note title="Loading…" />;
  else if (!data.guide)
    body = (
      <Note title="This guide can't be shown">{data.problems.map((p) => `${p.where}: ${p.message}`).join("\n")}</Note>
    );
  else {
    const ch = Math.min(chapter, data.guide.chapters.length - 1);
    body = (
      <ChapterView
        key={ch}
        data={data}
        chapter={ch}
        narrow={width < NARROW}
        setChapter={setChapter}
        reviewedChapters={reviewedChapters}
        setChapterReviewed={(n, v) => toggleChapter(String(n), v)}
        reviewedFiles={reviewedFiles}
        setFileReviewed={toggleFile}
      />
    );
  }
  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col">
      {body}
    </div>
  );
}

function ChapterView(props: {
  data: ResolvedGuide;
  chapter: number;
  narrow: boolean;
  setChapter: (n: number) => void;
  reviewedChapters: Set<string>;
  setChapterReviewed: (n: number, v: boolean) => void;
  reviewedFiles: Set<string>;
  setFileReviewed: (path: string, v: boolean) => void;
}) {
  const { data, chapter, narrow, setChapter, reviewedFiles, setFileReviewed } = props;
  const chapters = data.guide.chapters;
  const c = chapters[chapter];
  const total = chapters.length;
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Lines shown per excerpt. The panel remounts this per chapter.
  const initial = useMemo(
    () =>
      Object.fromEntries(
        c.excerpts
          .filter((e) => data.files[e.path])
          .map((e) => [e.path, initialVisible(data.files[e.path], e.lines?.map(parseRange))]),
      ),
    [c, data.files],
  );
  const [visible, setVisible] = useState<Record<string, boolean[]>>(initial);
  const [marked, setMarked] = useState<{ path: string; range: [number, number] }>();
  const [back, setBack] = useState<number>();
  const [fileIdx, setFileIdx] = useState(0);

  const reveal = useCallback((path: string, from: number, to: number) => {
    setVisible((prev) => {
      const next = [...prev[path]];
      for (let i = from; i <= to; i++) next[i] = true;
      return { ...prev, [path]: next };
    });
  }, []);

  /** Smoothly bring an element into the upper third of the scroller, remembering where we were. */
  const jumpTo = (el: Element | null | undefined, offset = 0.3) => {
    const p = scroller.current;
    if (!p || !el) return;
    const top = el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop;
    setBack(p.scrollTop);
    p.scrollTo({ top: Math.max(0, top - p.clientHeight * offset), behavior: "smooth" });
  };

  const onAnchor = (a: AnchorTarget) => {
    const file = data.files[a.path];
    const ir = file && indexRange(file, a.range);
    if (!ir) return;
    if (reviewedFiles.has(a.path)) setFileReviewed(a.path, false);
    flushSync(() => {
      reveal(a.path, ir[0], ir[1]);
      setMarked({ path: a.path, range: ir });
    });
    jumpTo(document.getElementById(fileDomId(chapter, a.path))?.querySelector(`[data-idx="${ir[0]}"]`));
  };

  // Citations from chat or a quiz land here when this chapter shows the file.
  useLineShower("guide", {
    canShow: (path) => c.excerpts.some((e) => e.path === path) && !!data.files[path],
    show: (t) => onAnchor({ kind: "anchor", text: "", path: t.path, range: { start: t.start, end: t.end } }),
  });

  const onFile = (i: number) => {
    const path = c.excerpts[i]?.path;
    if (!path) return;
    setFileIdx(i);
    setMarked(undefined);
    jumpTo(document.getElementById(fileDomId(chapter, path)), 0);
  };

  const goBack = () => {
    scroller.current?.scrollTo({ top: back ?? 0, behavior: "instant" });
    setBack(undefined);
    setMarked(undefined);
  };

  // Keys work while focus is inside this panel, so two panels never fight over them.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    const step = (d: number) => setChapter(Math.min(total - 1, Math.max(0, chapter + d)));
    if ((e.altKey && e.key === "ArrowDown") || (plain && e.key === "j")) step(1);
    else if ((e.altKey && e.key === "ArrowUp") || (plain && e.key === "k")) step(-1);
    else if (plain && e.key === "]") onFile((fileIdx + 1) % c.excerpts.length);
    else if (plain && e.key === "[") onFile((fileIdx - 1 + c.excerpts.length) % c.excerpts.length);
    else if (plain && e.key === "r") props.setChapterReviewed(chapter, !props.reviewedChapters.has(String(chapter)));
    else if (e.key === "Escape" && back !== undefined) goBack();
    else return;
    e.preventDefault();
  };

  const prose = (
    <div className={cn("flex flex-col gap-4", narrow ? "border-b border-border-subtle p-4" : "")}>
      <div className="flex flex-col gap-2.5">
        <h2 className="text-xl leading-tight font-semibold tracking-[-0.01em]">{c.title}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[11.5px] text-fg-2">
            {pad(chapter + 1)} / {pad(total)}
          </span>
          <NavButton dir="prev" disabled={chapter <= 0} onClick={() => setChapter(chapter - 1)} />
          <NavButton dir="next" disabled={chapter >= total - 1} onClick={() => setChapter(chapter + 1)} />
          <span className="w-1.5" />
          <Reviewed
            checked={props.reviewedChapters.has(String(chapter))}
            onChange={(v) => props.setChapterReviewed(chapter, v)}
          />
        </div>
      </div>
      <Prose body={c.body} onAnchor={onAnchor} />
      <nav aria-label="Files in this chapter" className="flex flex-col gap-1.5">
        {c.excerpts.map((e, i) => {
          const f = data.files[e.path];
          const { name, dir } = splitPath(e.path);
          return (
            <button
              key={e.path}
              onClick={() => onFile(i)}
              title={e.path}
              className={cn(
                "flex min-w-0 items-center gap-2 border border-border-subtle bg-surface px-[9px] py-[7px] text-left hover:border-border",
                reviewedFiles.has(e.path) && "opacity-55",
              )}
            >
              <LangTag path={e.path} />
              <span className="flex-none font-mono text-xs">{name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-3">{dir}</span>
              {f && <ChangeCount file={f} />}
            </button>
          );
        })}
      </nav>
    </div>
  );

  const code = (
    <div className="flex flex-col gap-3 p-3 pb-[50vh]">
      {c.excerpts.map((e) => {
        const f = data.files[e.path];
        if (!f)
          return (
            <div key={e.path} className="border border-dashed border-del px-3 py-2 text-sm text-del">
              {e.path} could not be found.
            </div>
          );
        return (
          <FileCard
            key={`${chapter}:${e.path}`}
            id={fileDomId(chapter, e.path)}
            file={f}
            visible={visible[e.path]}
            marked={marked?.path === e.path ? marked.range : undefined}
            onReveal={(from, to) => reveal(e.path, from, to)}
            collapsed={reviewedFiles.has(e.path)}
            actions={
              <>
                <span className="h-3.5 w-px flex-none bg-border" />
                <Reviewed checked={reviewedFiles.has(e.path)} onChange={(v) => setFileReviewed(e.path, v)} />
              </>
            }
          />
        );
      })}
    </div>
  );

  const goBackChip = back !== undefined && (
    <div className="absolute top-3 right-6 z-20 flex h-7 items-center gap-2 border border-accent bg-surface pr-1.5 pl-2.5 shadow-active">
      <button onClick={goBack} className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent-fg">
        <Icon paths={["M10 4L6 8l4 4"]} size={12} />
        Go back
      </button>
      <kbd className="min-w-4 border border-border bg-surface-3 px-1 text-center font-mono text-[10.5px] leading-4 text-fg-2">
        Esc
      </kbd>
    </div>
  );

  return (
    <div
      ref={root}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={(e) =>
        !(e.target as HTMLElement).closest("button,input,a,label") && root.current?.focus({ preventScroll: true })
      }
      className="relative flex min-h-0 flex-1 outline-none"
    >
      {narrow ? (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          {prose}
          {code}
        </div>
      ) : (
        <>
          <div className="w-[300px] flex-none overflow-y-auto border-r border-border-subtle p-5">{prose}</div>
          <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto bg-surface-2">
            {code}
          </div>
        </>
      )}
      {goBackChip}
    </div>
  );
}

function NavButton({ dir, disabled, onClick }: { dir: "next" | "prev"; disabled: boolean; onClick: () => void }) {
  const label = dir === "next" ? "Next chapter" : "Previous chapter";
  const keys = `${isMac ? "⌥" : "Alt+"}${dir === "next" ? "↓" : "↑"} or ${dir === "next" ? "J" : "K"}`;
  return (
    <button
      aria-label={label}
      title={`${label} (${keys})`}
      disabled={disabled}
      onClick={onClick}
      className="flex size-[22px] items-center justify-center border border-border bg-surface text-fg-2 hover:border-fg-3 hover:text-fg disabled:opacity-40"
    >
      <Icon paths={dir === "next" ? ["M8 3v10M4 9l4 4 4-4"] : ["M8 13V3M4 7l4-4 4 4"]} size={12} />
    </button>
  );
}

function Note({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="m-auto flex max-w-sm flex-col gap-2 p-6 text-center">
      <span className="text-[13px] font-medium text-fg-2">{title}</span>
      {children && <span className="text-[12.5px] whitespace-pre-line text-fg-3">{children}</span>}
    </div>
  );
}
