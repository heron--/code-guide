import { memo, type ReactNode } from "react";
import type { Line, ResolvedFile, Token } from "../../shared/guide";
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

/** What a panel adds to one line: a class, a gutter sign in place of the diff's, and something after the code. */
export type LineDecoration = { className?: string; sign?: ReactNode; after?: ReactNode };

/**
 * A line's tokens cut into rows of at most `cols` characters, at a space or punctuation where one is near the end.
 * Rows after the first keep the line's indent, plus two, so a wrapped line still reads as one.
 */
export function wrapTokens(tokens: Token[], cols: number): Token[][] {
  const flat = tokens.map(([t, l, d]): Token => [t.replace(/\t/g, "    "), l, d]);
  const text = flat.map((t) => t[0]).join("");
  if (text.length <= cols) return [tokens];
  const indent = " ".repeat(Math.min(text.match(/^\s*/)![0].length + 2, Math.floor(cols / 2)));
  const cuts: number[] = [];
  for (let at = 0, room = cols; text.length - at > room; room = cols - indent.length) {
    const row = text.slice(at, at + room);
    const soft = Math.max(...[" ", "(", ",", "."].map((c) => row.lastIndexOf(c)));
    at += soft > room / 2 ? soft + 1 : room;
    cuts.push(at);
  }
  const rows: Token[][] = [[]];
  let pos = 0;
  for (const [t, l, d] of flat) {
    for (let rest = t; rest.length;) {
      const next = cuts[rows.length - 1] ?? Infinity;
      if (pos === next) {
        rows.push([[indent]]);
        continue;
      }
      const piece = rest.slice(0, next - pos);
      rows.at(-1)!.push([piece, l, d]);
      pos += piece.length;
      rest = rest.slice(piece.length);
    }
  }
  return rows;
}

const Code = memo(function Code({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map(([text, l, d], i) =>
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

function Row(props: {
  line: Line;
  idx: number;
  marked: boolean;
  deleted: boolean;
  decoration?: LineDecoration;
  wrap?: number;
}) {
  const { line, idx, marked, deleted, decoration: dec, wrap } = props;
  const bg = line.k === "+" ? "bg-add-bg-strong" : line.k === "-" ? "bg-del-bg-strong" : "bg-surface-2";
  const gutter = (first: boolean) => (
    <>
      <span className={cn("w-[42px] flex-none pr-2.5 text-right text-[11px] text-fg-3 select-none", bg)}>
        {!first ? "↳" : deleted ? line.o : line.k === "-" ? line.o : line.n}
      </span>
      <span
        className={cn(
          "w-[18px] flex-none text-center select-none",
          line.k === "+" ? "text-add" : line.k === "-" ? "text-del" : "text-fg-3",
        )}
      >
        {first && (dec?.sign ?? (line.k === " " ? "" : line.k === "-" ? "−" : "+"))}
      </span>
    </>
  );
  const rows = wrap ? wrapTokens(line.t, wrap) : [line.t];
  return (
    <div
      data-idx={idx}
      className={cn(
        "flex min-w-max flex-col leading-5",
        wrap && "min-w-0",
        line.k === "+" && "bg-add-bg",
        line.k === "-" && "bg-del-bg",
        marked && "line-marked",
        dec?.className,
      )}
    >
      {rows.map((tokens, r) => (
        <div key={r} className="flex h-5">
          {gutter(r === 0)}
          <span className="pr-4 whitespace-pre">
            <span data-code="">
              <Code tokens={tokens} />
            </span>
            {!wrap && r === rows.length - 1 && dec?.after}
          </span>
        </div>
      ))}
      {wrap && dec?.after && (
        <div className="flex min-h-5">
          {gutter(false)}
          <span className="min-w-0 pr-4">{dec.after}</span>
        </div>
      )}
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
  label?: ReactNode;
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
        {props.label ?? (
          <span>
            {count} {label} line{count === 1 ? "" : "s"}
          </span>
        )}
        {!props.label && scope && <span className="truncate text-fg-4">{scope.trim()}</span>}
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
  /** What a panel adds to each line, by index. */
  decorate?: (idx: number) => LineDecoration | undefined;
  /** A collapsed stretch's own label, in place of its line count (e.g. a branch a trace doesn't take). */
  gapLabel?: (from: number, to: number) => ReactNode | undefined;
  /** Wrap lines longer than this many characters, marking each continuation ↳. */
  wrap?: number;
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
          decoration={props.decorate?.(i)}
          wrap={props.wrap}
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
          label={props.gapLabel?.(i, j)}
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
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-3" title={file.path}>
          {dir}
        </span>
        <ChangeCount file={file} />
        {props.actions}
      </header>
      {!props.collapsed && (
        <div className={cn("font-mono text-xs", props.wrap ? "overflow-x-hidden" : "overflow-x-auto")}>
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
