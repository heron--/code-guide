import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { parseRange, type Problem, type ResolvedGuide } from "../../shared/guide";
import { ChangeCount, FileCard, LangTag, Reviewed, splitPath } from "@/code/FileCard";
import { indexRange, initialVisible } from "@/code/excerpt";
import { api } from "@/lib/api";
import type { PanelProps } from "@/lib/panels";
import { usePersistent, usePersistentSet } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useActions, useLineShower } from "@/workspace/actions";
import { useAskSelection } from "@/workspace/ask";
import { Icon } from "@/workspace/Icon";
import { altKey, isMac, Kbd } from "@/workspace/Kbd";
import { Prose, type AnchorTarget } from "./Prose";

const pad = (n: number) => String(n).padStart(2, "0");
const fileDomId = (chapter: number, path: string) => `c${chapter}-${encodeURIComponent(path)}`;
const shownKey = (chapter: number, path: string) => `${chapter}:${path}`;

/** Narrower than this, prose and file list stack above the code. */
const NARROW = 720;

type Loaded = ResolvedGuide | { problems: Problem[]; guide?: undefined };

/** The Guide module: one chapter at a time, prose beside the code it's about, every chapter in one scroll. */
export default function GuidePanel({ state, job }: PanelProps) {
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!job) return;
    // A revision replaces the guide while this panel stays open: drop answers for the old one.
    let current = true;
    setData(undefined);
    setError(undefined);
    api.guide(job).then(
      (d) => current && setData(d),
      (e) => current && setError(e.message),
    );
    return () => {
      current = false;
    };
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
  else
    body = (
      <GuideView
        job={job!}
        data={data}
        chapter={Math.min(chapter, data.guide.chapters.length - 1)}
        narrow={width < NARROW}
        setChapter={setChapter}
        reviewedChapters={reviewedChapters}
        setChapterReviewed={(n, v) => toggleChapter(String(n), v)}
        reviewedFiles={reviewedFiles}
        setFileReviewed={toggleFile}
      />
    );
  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col">
      {body}
    </div>
  );
}

/** Where in the scroller, as a fraction of its height, a chapter's start has to pass for it to be current. */
const CURRENT_LINE = 0.2;

/**
 * Every chapter's code in one scroll, the current chapter's prose beside it (above each chapter's code when
 * narrow). Scrolling down, a chapter becomes current as its first file reaches the top; scrolling up, the one
 * before it does as its last file comes back.
 */
function GuideView(props: {
  job: string;
  data: ResolvedGuide;
  chapter: number;
  narrow: boolean;
  setChapter: (n: number) => void;
  reviewedChapters: Set<string>;
  setChapterReviewed: (n: number, v: boolean) => void;
  reviewedFiles: Set<string>;
  setFileReviewed: (path: string, v: boolean) => void;
}) {
  const { job, data, chapter, narrow, setChapter, reviewedFiles, setFileReviewed } = props;
  const { ask } = useActions();
  const chapters = data.guide.chapters;
  const c = chapters[chapter];
  const total = chapters.length;
  const scroller = useRef<HTMLDivElement>(null);
  const proseColumn = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);

  // Lines shown per excerpt. A file can be in two chapters with different lines, so each chapter has its own.
  const initial = useMemo(
    () =>
      Object.fromEntries(
        chapters.flatMap((ch, i) =>
          ch.excerpts
            .filter((e) => data.files[e.path])
            .map((e) => [shownKey(i, e.path), initialVisible(data.files[e.path], e.lines?.map(parseRange))]),
        ),
      ),
    [chapters, data.files],
  );
  const [visible, setVisible] = useState<Record<string, boolean[]>>(initial);
  const [marked, setMarked] = useState<{ chapter: number; path: string; range: [number, number] }>();
  const [back, setBack] = useState<number>();
  // The file last jumped to, by chapter: a new chapter starts at its first.
  const [file, setFile] = useState({ chapter, idx: 0 });
  const fileIdx = file.chapter === chapter ? file.idx : 0;

  const reveal = useCallback((key: string, from: number, to: number) => {
    setVisible((prev) => {
      const next = [...prev[key]];
      for (let i = from; i <= to; i++) next[i] = true;
      return { ...prev, [key]: next };
    });
  }, []);

  // A new chapter's prose starts from the top.
  useEffect(() => {
    proseColumn.current?.scrollTo({ top: 0 });
  }, [chapter]);

  /** The chapter whose start has passed the current line. */
  const jumping = useRef(false);
  const onScroll = () => {
    const p = scroller.current;
    if (!p || jumping.current) return;
    const line = p.getBoundingClientRect().top + p.clientHeight * CURRENT_LINE;
    let current = 0;
    sections.current.forEach((s, i) => s && s.getBoundingClientRect().top <= line && (current = i));
    if (current !== chapter) setChapter(current);
  };

  /** Scroll a chapter's start to the top. Its own scroll doesn't pick the chapter: a short one would lose out. */
  const goToChapter = (n: number) => {
    const p = scroller.current;
    const s = sections.current[n];
    if (n < 0 || n >= total || !p || !s) return;
    setChapter(n);
    setBack(undefined);
    jumping.current = true;
    p.scrollTo({
      top: s.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop,
      behavior: "instant",
    });
    requestAnimationFrame(() => requestAnimationFrame(() => (jumping.current = false)));
  };

  // Open where the reader left off, and stay there when the layout swaps scrollers (wide ⇄ narrow).
  useLayoutEffect(() => {
    if (chapter > 0) goToChapter(chapter);
  }, [narrow]);

  /** Smoothly bring an element into the upper third of the scroller, remembering where we were. */
  const jumpTo = (el: Element | null | undefined, offset = 0.3) => {
    const p = scroller.current;
    if (!p || !el) return;
    const top = el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop;
    setBack(p.scrollTop);
    p.scrollTo({ top: Math.max(0, top - p.clientHeight * offset), behavior: "smooth" });
  };

  const onAnchor = (a: AnchorTarget, ch = chapter) => {
    const file = data.files[a.path];
    const ir = file && indexRange(file, a.range);
    if (!ir || !visible[shownKey(ch, a.path)]) return;
    if (reviewedFiles.has(a.path)) setFileReviewed(a.path, false);
    flushSync(() => {
      reveal(shownKey(ch, a.path), ir[0], ir[1]);
      setMarked({ chapter: ch, path: a.path, range: ir });
    });
    jumpTo(document.getElementById(fileDomId(ch, a.path))?.querySelector(`[data-idx="${ir[0]}"]`));
  };

  // Citations from chat or a quiz land here when a chapter shows the file: the current one if it can.
  const chapterWith = (path: string) =>
    [chapter, ...chapters.keys()].find((i) => chapters[i].excerpts.some((e) => e.path === path));
  useLineShower("guide", {
    canShow: (path) => chapterWith(path) !== undefined && !!data.files[path],
    show: (t) => {
      const ch = chapterWith(t.path)!;
      if (ch !== chapter) setChapter(ch);
      onAnchor({ kind: "anchor", text: "", path: t.path, range: { start: t.start, end: t.end } }, ch);
    },
  });

  const onFile = (i: number, n = chapter) => {
    const path = chapters[n].excerpts[i]?.path;
    if (!path) return;
    if (n !== chapter) setChapter(n);
    setFile({ chapter: n, idx: i });
    setMarked(undefined);
    jumpTo(document.getElementById(fileDomId(n, path)), 0);
  };

  const goBack = () => {
    scroller.current?.scrollTo({ top: back ?? 0, behavior: "instant" });
    setBack(undefined);
    setMarked(undefined);
  };

  // Selecting prose or code offers to ask about it in Chat.
  const selecting = useAskSelection(root, {
    file: (path) => data.files[path],
    // Narrow, every chapter's prose is on screen: the block says which one was selected.
    prose: (text, block) => ({ kind: "prose", job, chapter: Number(block.dataset.prose || chapter), text }),
  });

  // Keys work while focus is inside this panel, so two panels never fight over them.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if ((e.altKey && e.key === "ArrowDown") || (plain && e.key === "j")) goToChapter(Math.min(total - 1, chapter + 1));
    else if ((e.altKey && e.key === "ArrowUp") || (plain && e.key === "k")) goToChapter(Math.max(0, chapter - 1));
    else if (plain && e.key === "]") onFile((fileIdx + 1) % c.excerpts.length);
    else if (plain && e.key === "[") onFile((fileIdx - 1 + c.excerpts.length) % c.excerpts.length);
    else if (plain && e.key === "r") props.setChapterReviewed(chapter, !props.reviewedChapters.has(String(chapter)));
    // Go back: ⌘[ (Ctrl+[), like a browser or editor, or Esc.
    else if (back !== undefined && (e.key === "Escape" || (e.key === "[" && (isMac ? e.metaKey : e.ctrlKey)))) goBack();
    else if (!selecting.onKey(e)) return;
    e.preventDefault();
  };

  const prose = (n: number) => {
    const ch = chapters[n];
    return (
      <div className={cn("flex flex-col gap-4", narrow ? "border-b border-border-subtle p-4" : "")}>
        <div className="flex flex-col gap-2.5">
          <h2 className="text-xl leading-tight font-semibold tracking-[-0.01em]">{ch.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[11.5px] text-fg-2">
              {pad(n + 1)} / {pad(total)}
            </span>
            <NavButton dir="prev" disabled={n <= 0} onClick={() => goToChapter(n - 1)} />
            <NavButton dir="next" disabled={n >= total - 1} onClick={() => goToChapter(n + 1)} />
            <span className="w-1.5" />
            <Reviewed
              checked={props.reviewedChapters.has(String(n))}
              onChange={(v) => props.setChapterReviewed(n, v)}
            />
            <span className="flex-1" />
            <button
              onClick={() => ask({ kind: "chapter", job, chapter: n })}
              title="Ask about this chapter in Chat"
              className="flex h-6 items-center gap-1.5 border border-border bg-surface px-[9px] text-xs hover:border-fg-3"
            >
              <Icon paths={["M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"]} size={12} className="text-fg-2" />
              Ask
            </button>
          </div>
        </div>
        <div data-prose={n}>
          <Prose body={ch.body} onAnchor={(a) => onAnchor(a, n)} />
        </div>
        <nav aria-label="Files in this chapter" className="flex flex-col gap-1.5">
          {ch.excerpts.map((e, i) => {
            const f = data.files[e.path];
            const { name, dir } = splitPath(e.path);
            return (
              <button
                key={e.path}
                onClick={() => onFile(i, n)}
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
  };

  const code = (n: number) => (
    <div className="flex flex-col gap-3 p-3">
      {!narrow && (
        <div className="flex items-baseline gap-2 px-0.5 pt-1 text-[12px] text-fg-3">
          <span className="font-mono text-[11px]">{pad(n + 1)}</span>
          <span className="truncate">{chapters[n].title}</span>
        </div>
      )}
      {chapters[n].excerpts.map((e) => {
        const f = data.files[e.path];
        if (!f)
          return (
            <div key={e.path} className="border border-dashed border-del px-3 py-2 text-sm text-del">
              {e.path} could not be found.
            </div>
          );
        return (
          <FileCard
            key={e.path}
            id={fileDomId(n, e.path)}
            file={f}
            visible={visible[shownKey(n, e.path)]}
            marked={marked?.chapter === n && marked.path === e.path ? marked.range : undefined}
            onReveal={(from, to) => reveal(shownKey(n, e.path), from, to)}
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

  // Room below the last chapter, so its start can reach the top.
  const sectionsList = (
    <div className="pb-[50vh]">
      {chapters.map((_, n) => (
        <section key={n} ref={(el) => void (sections.current[n] = el)} aria-label={`Chapter ${n + 1}`}>
          {narrow && prose(n)}
          {code(n)}
        </section>
      ))}
    </div>
  );

  const goBackChip = back !== undefined && (
    <div className="absolute top-3 right-6 z-20 flex h-7 items-center gap-2 border border-accent bg-surface pr-1.5 pl-2.5 shadow-active">
      <button onClick={goBack} className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent-fg">
        <Icon paths={["M10 4L6 8l4 4"]} size={12} />
        Go back
      </button>
      <Kbd>{isMac ? "⌘[" : "Ctrl+["}</Kbd>
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
      onMouseUp={selecting.onMouseUp}
      className="relative flex min-h-0 flex-1 outline-none"
    >
      {narrow ? (
        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          {sectionsList}
        </div>
      ) : (
        <>
          {/* The prose column grows with the panel (the design: 300px in a slot, 380px maximized), capped for line length. */}
          <div
            ref={proseColumn}
            className="w-[clamp(300px,27%,480px)] flex-none overflow-y-auto border-r border-border-subtle p-5"
          >
            {prose(chapter)}
          </div>
          <div ref={scroller} onScroll={onScroll} className="min-w-0 flex-1 overflow-y-auto bg-surface-2">
            {sectionsList}
          </div>
        </>
      )}
      {goBackChip}
      {selecting.chip}
    </div>
  );
}

function NavButton({ dir, disabled, onClick }: { dir: "next" | "prev"; disabled: boolean; onClick: () => void }) {
  const label = dir === "next" ? "Next chapter" : "Previous chapter";
  return (
    <span className="group/nav relative flex">
      <button
        aria-label={label}
        aria-keyshortcuts={dir === "next" ? "Alt+ArrowDown J" : "Alt+ArrowUp K"}
        // aria-disabled, not disabled: a disabled button drops focus, and the panel's keys with it.
        aria-disabled={disabled}
        onClick={() => !disabled && onClick()}
        className="flex size-[22px] items-center justify-center border border-border bg-surface text-fg-2 hover:border-fg-3 hover:text-fg aria-disabled:pointer-events-none aria-disabled:opacity-40"
      >
        <Icon paths={dir === "next" ? ["M8 3v10M4 9l4 4 4-4"] : ["M8 13V3M4 7l4-4 4 4"]} size={12} />
      </button>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none invisible absolute top-[30px] -left-1 z-30 flex items-center gap-1.5 border border-rule bg-surface px-2 py-[5px] text-xs whitespace-nowrap text-fg shadow-active",
          !disabled && "group-hover/nav:visible group-has-focus-visible/nav:visible",
        )}
      >
        {label}
        <span className="flex gap-0.5">
          <Kbd>{altKey}</Kbd>
          <Kbd>{dir === "next" ? "↓" : "↑"}</Kbd>
        </span>
        <span className="text-fg-3">or</span>
        <Kbd>{dir === "next" ? "J" : "K"}</Kbd>
      </span>
    </span>
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
