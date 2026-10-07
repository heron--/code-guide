import { memo, type ReactNode } from "react";
import type { Line, ResolvedFile } from "../../shared/guide";
import { cn } from "@/lib/utils";
import { Icon } from "@/workspace/Icon";
import { EXPAND_STEP, enclosingLine } from "./excerpt";

export function splitPath(path: string) {
  const i = path.lastIndexOf("/");
  return { name: path.slice(i + 1), dir: i < 0 ? "" : path.slice(0, i + 1) };
}

/** A small language tag from the extension, e.g. "TS", "GO". */
export function LangTag({ path }: { path: string }) {
  const ext = path.includes(".") ? path.split(".").pop()!.slice(0, 4).toUpperCase() : "—";
  return (
    <span className="flex-none border border-border px-[3px] font-mono text-[8.5px] leading-3 font-semibold tracking-[0.04em] text-fg-2">
      {ext}
    </span>
  );
}

export function ChangeCount({ file }: { file: Pick<ResolvedFile, "additions" | "deletions"> }) {
  if (!file.additions && !file.deletions) return null;
  return (
    <span className="flex flex-none gap-1.5 font-mono text-[11px] tabular-nums">
      {file.additions > 0 && <span className="text-add">+{file.additions}</span>}
      {file.deletions > 0 && <span className="text-del">−{file.deletions}</span>}
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
        "flex h-5 min-w-max leading-5",
        line.k === "+" && "bg-add-bg",
        line.k === "-" && "bg-del-bg",
        marked && "line-marked",
      )}
    >
      <span
        className={cn(
          "w-[42px] flex-none pr-2.5 text-right text-[11px] text-fg-3 select-none",
          line.k === "+" ? "bg-add-bg-strong" : line.k === "-" ? "bg-del-bg-strong" : "bg-surface-2",
        )}
      >
        {deleted ? line.o : line.k === "-" ? line.o : line.n}
      </span>
      <span
        className={cn(
          "w-[18px] flex-none text-center select-none",
          line.k === "+" ? "text-add" : line.k === "-" ? "text-del" : "text-fg-3",
        )}
      >
        {line.k === " " ? "" : line.k === "-" ? "−" : "+"}
      </span>
      <span className="pr-4 whitespace-pre">
        <Code line={line} />
      </span>
    </div>
  );
}

const up = ["M8 12V5M5 8l3-3 3 3M4 3h8"];
const down = ["M8 4v7M5 8l3 3 3-3M4 13h8"];

function Gap(props: {
  lines: Line[];
  isDiff: boolean;
  visible: boolean[];
  from: number;
  to: number;
  onReveal: (from: number, to: number) => void;
}) {
  const { lines, isDiff, visible, from, to, onReveal } = props;
  const count = to - from + 1;
  const atTop = from === 0;
  const atBottom = to === lines.length - 1;
  const label = isDiff && lines.slice(from, to + 1).every((l) => l.k === " ") ? "unchanged" : "hidden";
  // Like a diff hunk header: what the next shown lines sit inside, unless it's already on screen.
  const enclosing = atBottom ? undefined : enclosingLine(lines, to + 1);
  const scope = enclosing && !visible[enclosing.idx] ? enclosing.text : undefined;
  const btn = "flex h-6 w-[42px] items-center justify-center text-fg-3 hover:bg-surface-3 hover:text-fg";
  return (
    <div className="flex min-h-[26px] min-w-max items-center border-y border-border-subtle bg-surface-4 text-[11px] text-fg-3">
      <span className="flex w-[42px] flex-none flex-col">
        {!atTop && (
          <button
            aria-label="Expand down"
            title={`Show ${Math.min(EXPAND_STEP, count)} lines below`}
            className={btn}
            onClick={() => onReveal(from, Math.min(to, from + EXPAND_STEP - 1))}
          >
            <Icon paths={down} size={12} />
          </button>
        )}
        {!atBottom && (
          <button
            aria-label="Expand up"
            title={`Show ${Math.min(EXPAND_STEP, count)} lines above`}
            className={btn}
            onClick={() => onReveal(Math.max(from, to - EXPAND_STEP + 1), to)}
          >
            <Icon paths={up} size={12} />
          </button>
        )}
      </span>
      <button
        className="flex min-w-0 flex-1 gap-6 pr-4 pl-[18px] text-left hover:text-fg"
        onClick={() => onReveal(from, to)}
        title="Show all"
      >
        <span>
          {count} {label} line{count === 1 ? "" : "s"}
        </span>
        {scope && <span className="truncate text-fg-4">{scope.trim()}</span>}
      </button>
    </div>
  );
}

/** One file's code: its lines, with hidden stretches collapsed into rows that expand up or down. */
export function FileCard(props: {
  id: string;
  file: ResolvedFile;
  visible: boolean[];
  marked?: [number, number];
  onReveal: (from: number, to: number) => void;
  /** Controls at the end of the header, e.g. a Reviewed toggle. */
  actions?: ReactNode;
  collapsed?: boolean;
}) {
  const { id, file, visible, marked, onReveal } = props;
  const { name, dir } = splitPath(file.path);
  const rows: ReactNode[] = [];
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
    <section id={id} data-path={file.path} aria-label={file.path} className="flex-none border border-border bg-surface">
      <header className="sticky top-0 z-10 flex h-8 min-w-0 items-center gap-2 border-b border-border bg-surface-3 px-2.5">
        <LangTag path={file.path} />
        <span
          className={cn(
            "flex-none font-mono text-xs font-medium",
            file.status === "added" && "text-add",
            file.status === "deleted" && "text-del line-through",
          )}
        >
          {name}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-3">{dir}</span>
        <ChangeCount file={file} />
        {props.actions}
      </header>
      {!props.collapsed && (
        <div className="overflow-x-auto font-mono text-xs">
          {file.lines.length ? rows : <div className="px-3 py-2 font-sans text-sm text-fg-3">No text content.</div>}
        </div>
      )}
    </section>
  );
}

export function Reviewed({
  checked,
  onChange,
  label = "Reviewed",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="flex flex-none cursor-pointer items-center gap-1.5 text-[11.5px] text-fg-2">
      <input
        type="checkbox"
        className="size-[13px] accent-accent"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
