import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowDown, ArrowUp, ChevronLeft } from "lucide-react";
import { parseRange, type ResolvedGuide } from "../../shared/guide";
import { Button } from "./ui/button";
import { ReviewedToggle } from "./ui/checkbox";
import { Kbd, Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { FileCard } from "./FileCard";
import { FileRow } from "./FileRow";
import { Prose, type AnchorTarget } from "./Prose";
import { indexRange, initialVisible } from "@/lib/excerpt";
import { cn } from "@/lib/utils";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_KEYS = isMac ? ["⌘", "⌥", "⇧"] : ["Ctrl", "Alt", "⇧"];

export function fileDomId(chapter: number, path: string) {
  return `c${chapter}-${encodeURIComponent(path)}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function GuideTab({
  data,
  chapter,
  setChapter,
  reviewedChapters,
  setChapterReviewed,
  reviewedFiles,
  setFileReviewed,
}: {
  data: ResolvedGuide;
  chapter: number;
  setChapter: (n: number) => void;
  reviewedChapters: Set<string>;
  setChapterReviewed: (n: number, v: boolean) => void;
  reviewedFiles: Set<string>;
  setFileReviewed: (path: string, v: boolean) => void;
}) {
  const chapters = data.guide.chapters;
  const c = chapters[chapter];
  const total = chapters.length;
  const pane = useRef<HTMLDivElement>(null);

  // Lines shown per excerpt. The parent remounts this component per chapter.
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

  const reveal = useCallback((path: string, from: number, to: number) => {
    setVisible((prev) => {
      const next = [...prev[path]];
      for (let i = from; i <= to; i++) next[i] = true;
      return { ...prev, [path]: next };
    });
  }, []);

  /** Smoothly bring an element into the upper third of the code pane, remembering where we were. */
  const jumpTo = (el: Element | null | undefined, offset = 0.3) => {
    const p = pane.current;
    if (!p || !el) return;
    const top = el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop;
    setBack(p.scrollTop);
    p.scrollTo({ top: Math.max(0, top - p.clientHeight * offset), behavior: "smooth" });
  };

  const onAnchor = (a: AnchorTarget) => {
    const file = data.files[a.path];
    if (!file) return;
    const ir = indexRange(file, a.range);
    if (!ir) return;
    if (reviewedFiles.has(a.path)) setFileReviewed(a.path, false);
    flushSync(() => {
      reveal(a.path, ir[0], ir[1]);
      setMarked({ path: a.path, range: ir });
    });
    const card = document.getElementById(fileDomId(chapter, a.path));
    jumpTo(card?.querySelector(`[data-idx="${ir[0]}"]`));
  };

  const onFile = (path: string) => {
    setMarked(undefined);
    jumpTo(document.getElementById(fileDomId(chapter, path)), 0);
  };

  const goBack = () => {
    pane.current?.scrollTo({ top: back ?? 0, behavior: "instant" });
    setBack(undefined);
    setMarked(undefined);
  };

  // Next/previous chapter: ⌘⌥⇧↓ / ⌘⌥⇧↑ (Ctrl+Alt+Shift elsewhere), or J / K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const mod = (isMac ? e.metaKey : e.ctrlKey) && e.altKey && e.shiftKey;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      let d = 0;
      if ((mod && e.key === "ArrowDown") || (plain && e.key.toLowerCase() === "j")) d = 1;
      if ((mod && e.key === "ArrowUp") || (plain && e.key.toLowerCase() === "k")) d = -1;
      if (e.key === "Escape" && back !== undefined) return goBack();
      if (!d) return;
      e.preventDefault();
      setChapter(Math.min(total - 1, Math.max(0, chapter + d)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex min-h-0 flex-1">
      <ChapterRail
        titles={chapters.map((ch) => ch.title)}
        current={chapter}
        reviewed={reviewedChapters}
        onSelect={setChapter}
      />

      {/* Prose */}
      <aside className="w-[clamp(320px,34vw,520px)] shrink-0 overflow-y-auto px-8 pb-16 pt-6">
        <h2 className="text-[28px] font-semibold leading-tight tracking-tight">{c.title}</h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="font-mono text-[15px] tabular-nums text-muted-foreground">
            <span className="text-foreground">{pad(chapter + 1)}</span> / {pad(total)}
          </span>
          <NavButton dir="next" disabled={chapter >= total - 1} onClick={() => setChapter(chapter + 1)} />
          <NavButton dir="prev" disabled={chapter <= 0} onClick={() => setChapter(chapter - 1)} />
          <span className="ml-1">
            <ReviewedToggle
              id={`chapter-${chapter}-reviewed`}
              checked={reviewedChapters.has(String(chapter))}
              onChange={(v) => setChapterReviewed(chapter, v)}
            />
          </span>
        </div>

        <Prose body={c.body} onAnchor={onAnchor} className="mt-7" />

        <div className="mt-8 space-y-2">
          {c.excerpts.map((e) => {
            const f = data.files[e.path];
            return (
              <FileRow
                key={e.path}
                path={e.path}
                additions={f?.additions ?? 0}
                deletions={f?.deletions ?? 0}
                status={f?.status}
                reviewed={reviewedFiles.has(e.path)}
                onClick={() => onFile(e.path)}
              />
            );
          })}
        </div>
      </aside>

      {/* Code */}
      <div className="relative min-w-0 flex-1">
        {back !== undefined && (
          <button
            onClick={goBack}
            className="absolute left-6 top-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-popover py-2 pl-3 pr-4 text-[15px] shadow-lg hover:bg-accent"
          >
            <ChevronLeft className="size-4" />
            Go back
          </button>
        )}
        {/* No top padding on the scroller itself, so sticky file headers pin flush to its edge. */}
        <div ref={pane} className="h-full overflow-y-auto pl-2 pr-6">
          <div className="space-y-4 pb-[60vh] pt-6">
            {c.excerpts.map((e) => {
              const f = data.files[e.path];
              if (!f) return <MissingFile key={e.path} path={e.path} />;
              return (
                <FileCard
                  key={`${chapter}:${e.path}`}
                  id={fileDomId(chapter, e.path)}
                  file={f}
                  visible={visible[e.path]}
                  marked={marked?.path === e.path ? marked.range : undefined}
                  onReveal={(from, to) => reveal(e.path, from, to)}
                  reviewed={reviewedFiles.has(e.path)}
                  onReviewed={(v) => setFileReviewed(e.path, v)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavButton({ dir, disabled, onClick }: { dir: "next" | "prev"; disabled: boolean; onClick: () => void }) {
  const Icon = dir === "next" ? ArrowDown : ArrowUp;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClick}
          aria-label={dir === "next" ? "Next chapter" : "Previous chapter"}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {dir === "next" ? "Next chapter" : "Previous chapter"}
        <span className="flex gap-1">
          {MOD_KEYS.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          <Kbd>{dir === "next" ? "↓" : "↑"}</Kbd>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function ChapterRail({
  titles,
  current,
  reviewed,
  onSelect,
}: {
  titles: string[];
  current: number;
  reviewed: Set<string>;
  onSelect: (n: number) => void;
}) {
  return (
    <nav className="flex w-5 shrink-0 flex-col items-start gap-2.5 pt-8" aria-label="Chapters">
      {titles.map((t, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <button onClick={() => onSelect(i)} className="flex h-2 w-full items-center" aria-label={t}>
              <span
                className={cn(
                  "block h-[2px] rounded-full transition-all",
                  i === current ? "w-4 bg-foreground" : "w-2.5 bg-muted-foreground/40 hover:bg-muted-foreground",
                  i !== current && reviewed.has(String(i)) && "bg-add/70",
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <span className="font-mono text-muted-foreground">{pad(i + 1)}</span> {t}
          </TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

function MissingFile({ path }: { path: string }) {
  return (
    <div className="rounded-xl border border-dashed border-del/50 bg-card px-4 py-3 text-sm text-del">
      {path} could not be found. Run <code className="font-mono">code-chapters check</code> on this guide.
    </div>
  );
}
