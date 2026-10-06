import { memo } from "react";
import { ArrowDownToLine, ArrowUpToLine, ChevronsUpDown } from "lucide-react";
import type { Line, ResolvedFile } from "../../shared/guide";
import { ReviewedToggle } from "./ui/checkbox";
import { EXPAND_STEP, enclosingLine } from "@/lib/excerpt";
import { cn } from "@/lib/utils";
import { FileIcon, splitPath } from "./FileRow";

export function ChangeCount({ file }: { file: Pick<ResolvedFile, "additions" | "deletions"> }) {
  return (
    <span className="shrink-0 font-mono text-[13px] tabular-nums">
      {file.additions > 0 && <span className="text-add">+{file.additions}</span>}
      {file.additions > 0 && file.deletions > 0 && " "}
      {file.deletions > 0 && <span className="text-del">-{file.deletions}</span>}
    </span>
  );
}

const Code = memo(function Code({ line }: { line: Line }) {
  return (
    <>
      {line.t.map(([text, l, d], i) =>
        l ? (
          <span key={i} className="tok" style={{ "--l": l, "--d": d } as React.CSSProperties}>
            {text}
          </span>
        ) : (
          <span key={i}>{text}</span>
        ),
      )}
    </>
  );
});

function Row({ line, idx, marked, deleted }: { line: Line; idx: number; marked: boolean; deleted: boolean }) {
  return (
    <div
      data-idx={idx}
      className={cn(
        "grid grid-cols-[3px_4rem_1fr] font-mono text-[13px] leading-6",
        line.k === "+" && "bg-add-bg",
        line.k === "-" && "bg-del-bg",
        marked && "line-marked",
      )}
    >
      <span className={cn(line.k === "+" && "bg-add", line.k === "-" && "bg-del")} />
      <span
        className={cn(
          "select-none pr-4 text-right tabular-nums text-muted-foreground/70",
          line.k === "-" && "text-del",
          line.k === "+" && "text-add",
        )}
      >
        {deleted ? line.o : line.k === "-" ? "–" : line.n}
      </span>
      <span className="whitespace-pre pr-6">
        <Code line={line} />
        {line.t.length === 0 && " "}
      </span>
    </div>
  );
}

function Gap({
  lines,
  isDiff,
  visible,
  from,
  to,
  onReveal,
}: {
  lines: Line[];
  isDiff: boolean;
  visible: boolean[];
  from: number;
  to: number;
  onReveal: (from: number, to: number) => void;
}) {
  const count = to - from + 1;
  const atTop = from === 0;
  const atBottom = to === lines.length - 1;
  const label = isDiff && lines.slice(from, to + 1).every((l) => l.k === " ") ? "unchanged" : "hidden";
  // Like a diff hunk header: what the next shown lines sit inside, unless it's already on screen.
  const enclosing = atBottom ? undefined : enclosingLine(lines, to + 1);
  const scope = enclosing && !visible[enclosing.idx] ? enclosing.text : undefined;
  const btn = "flex h-6 w-full items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground";
  return (
    <div className="grid grid-cols-[3px_4rem_1fr] items-stretch bg-muted/60 font-mono text-[13px] text-muted-foreground">
      <span />
      <span className="flex flex-col">
        {!atTop && (
          <button
            className={btn}
            title={`Show ${Math.min(EXPAND_STEP, count)} lines below`}
            onClick={() => onReveal(from, Math.min(to, from + EXPAND_STEP - 1))}
          >
            <ArrowDownToLine className="size-3.5" />
          </button>
        )}
        {!atBottom && (
          <button
            className={btn}
            title={`Show ${Math.min(EXPAND_STEP, count)} lines above`}
            onClick={() => onReveal(Math.max(from, to - EXPAND_STEP + 1), to)}
          >
            <ArrowUpToLine className="size-3.5" />
          </button>
        )}
      </span>
      <button
        className="flex min-w-0 items-center gap-8 pr-6 text-left hover:text-foreground"
        onClick={() => onReveal(from, to)}
        title="Show all"
      >
        <span className="min-w-0 truncate">{scope}</span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-sans text-[13px]">
          <ChevronsUpDown className="size-3.5" />
          {count} {label} line{count === 1 ? "" : "s"}
        </span>
      </button>
    </div>
  );
}

export function FileCard({
  id,
  file,
  visible,
  marked,
  onReveal,
  reviewed,
  onReviewed,
}: {
  id: string;
  file: ResolvedFile;
  visible: boolean[];
  marked?: [number, number];
  onReveal: (from: number, to: number) => void;
  reviewed: boolean;
  onReviewed: (v: boolean) => void;
}) {
  const { name, dir } = splitPath(file.path);
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < file.lines.length;) {
    if (visible[i]) {
      rows.push(
        <Row
          key={i}
          idx={i}
          line={file.lines[i]}
          deleted={file.status === "deleted"}
          marked={!!marked && i >= marked[0] && i <= marked[1]}
        />,
      );
      i++;
    } else {
      let j = i;
      while (j + 1 < file.lines.length && !visible[j + 1]) j++;
      rows.push(
        <Gap
          key={`g${i}`}
          lines={file.lines}
          isDiff={file.status !== "unchanged"}
          visible={visible}
          from={i}
          to={j}
          onReveal={onReveal}
        />,
      );
      i = j + 1;
    }
  }

  return (
    <section id={id} data-path={file.path} className="rounded-xl border border-border bg-card shadow-xs">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 rounded-t-xl border-b border-border bg-card px-4">
        <FileIcon path={file.path} />
        <span
          className={cn(
            "shrink-0 font-medium",
            file.status === "added" && "text-add",
            file.status === "deleted" && "text-del line-through",
          )}
        >
          {name}
        </span>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{dir}</span>
        <span className="ml-auto flex shrink-0 items-center gap-5 pl-4">
          <ChangeCount file={file} />
          <ReviewedToggle id={`${id}-reviewed`} checked={reviewed} onChange={onReviewed} />
        </span>
      </header>
      {!reviewed && (
        <div className="overflow-x-auto rounded-b-xl">
          <div className="w-max min-w-full py-1">
            {file.lines.length ? rows : <div className="px-4 py-3 text-sm text-muted-foreground">No text content.</div>}
          </div>
        </div>
      )}
    </section>
  );
}
