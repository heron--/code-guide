import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ResolvedFile } from "../../shared/guide";
import { CiteChip } from "@/code/CiteChip";
import { FileCard } from "@/code/FileCard";
import { indexRange, initialVisible } from "@/code/excerpt";
import { useAskSelection } from "@/workspace/ask";
import { Icon, icons } from "@/workspace/Icon";
import { cn } from "@/lib/utils";
import { StepText, Tip, Val } from "./bits";
import { INFERRED, type Frame, type Step, type Value } from "./trace";

type Props = {
  job: string;
  steps: Step[];
  frames: Frame[];
  at: number[];
  current: number;
  file: ResolvedFile;
  /** Wrap lines at this many characters (a narrow panel). */
  wrap?: number;
  /** Set to this excerpt's key handler (⌘L asks about the selection): true when it handled the key. */
  keys: React.RefObject<((e: React.KeyboardEvent) => boolean) | undefined>;
};

/** Lines far apart are shown as separate stretches rather than one long one. */
const SPAN = 30;

/** A value as it reads inline: `≈name = value` when inferred, plain when from the code. */
function Inline({ v }: { v: Value }) {
  const inferred = v.from === "inferred";
  return (
    <span className={cn("font-mono", inferred ? "text-fg-2 italic" : "text-fg")}>
      {inferred && <span className="mr-[0.25em] not-italic">{INFERRED}</span>}
      {v.name} = {v.value}
    </span>
  );
}

/** Where the pointer is in a line's code: the identifier chain up to the hovered part, e.g. `p.BaseDelay`. */
function identifierAt(x: number, y: number): { code: Element; start: number; end: number; name: string } | undefined {
  const d = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const pos = document.caretPositionFromPoint?.(x, y);
  const r = pos ? undefined : d.caretRangeFromPoint?.(x, y);
  const node = pos?.offsetNode ?? r?.startContainer;
  const offset = pos?.offset ?? r?.startOffset ?? 0;
  const code = node?.parentElement?.closest("[data-code]");
  if (!node || node.nodeType !== Node.TEXT_NODE || !code) return undefined;
  let at = 0;
  const walk = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n && n !== node; n = walk.nextNode()) at += n.textContent!.length;
  at += offset;
  const text = code.textContent ?? "";
  let start = at;
  let end = at;
  while (start > 0 && /[\w.]/.test(text[start - 1])) start--;
  while (end < text.length && /\w/.test(text[end])) end++;
  while (text[start] === ".") start++;
  if (start >= end) return undefined;
  return { code, start, end, name: text.slice(start, end) };
}

/** The DOM range covering characters [start, end) of an element's text. */
function rangeOf(el: Element, start: number, end: number): Range {
  const range = document.createRange();
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let at = 0;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const len = n.textContent!.length;
    if (start >= at && start <= at + len) range.setStart(n, start - at);
    if (end >= at && end <= at + len) {
      range.setEnd(n, end - at);
      break;
    }
    at += len;
  }
  return range;
}

type Hover = {
  value: Value;
  step: number;
  box: { left: number; top: number; width: number; height: number };
};

/** The current step's file as an excerpt: the current line marked, its values inline, others on hover. */
export function StepCode({ job, steps, frames, at, current, file, wrap, keys }: Props) {
  const s = steps[current];
  const frame = frames[at[current]];
  const idx = (line: number) => indexRange(file, { start: line, end: line })?.[1];

  // Lines run since the last step in this call, the values' lines, and the branches not taken, collapsed.
  const branches = useMemo(
    () =>
      (s.notTaken ?? []).flatMap((b) => {
        const [start, end = start] = b.lines.split("-").map(Number);
        const ir = indexRange(file, { start, end });
        return ir ? [{ from: ir[0], to: ir[1], reason: b.reason }] : [];
      }),
    [s, file],
  );
  const initial = useMemo(() => {
    const prev = current > 0 && at[current - 1] === at[current] && steps[current - 1].path === s.path;
    const near = [s.line, ...(prev ? [steps[current - 1].line] : []), ...(s.values ?? []).map((v) => v.line ?? s.line)];
    const lo = Math.min(...near.filter((l) => s.line - l <= SPAN));
    const ranges = [
      { start: Math.max(1, Math.min(lo, s.line - 4)), end: s.line + 3 },
      ...near.filter((l) => s.line - l > SPAN || l > s.line + 3).map((l) => ({ start: l, end: l })),
    ];
    const vis = initialVisible(file, ranges);
    for (const b of branches) {
      for (let i = b.from; i <= b.to; i++) vis[i] = false;
      if (b.from > 0) vis[b.from - 1] = true;
      if (b.to + 1 < vis.length) vis[b.to + 1] = true;
    }
    return vis;
  }, [file, s, current, at, steps, branches]);
  const [visible, setVisible] = useState(initial);
  const reveal = (from: number, to: number) => setVisible((v) => v.map((x, i) => x || (i >= from && i <= to)));

  const here = idx(s.line);
  const inline = useMemo(() => {
    const by = new Map<number, Value[]>();
    for (const v of s.values ?? []) {
      const i = idx(v.line ?? s.line);
      if (i !== undefined) by.set(i, [...(by.get(i) ?? []), v]);
    }
    return by;
  }, [s, file]);

  /** An identifier's value at this step: the latest given for it in this call, in this file. */
  const valueOf = (name: string): { value: Value; step: number } | undefined => {
    for (let j = current; j >= frame.start; j--) {
      if (steps[j].path !== s.path) continue;
      const v = steps[j].values?.find((v) => v.name === name);
      if (v) return { value: v, step: j };
    }
    return undefined;
  };

  // Bring the current line into view when the step changes.
  const wrapper = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const p = scroller.current;
    const row = p?.querySelector(`[data-idx="${here}"]`);
    if (!p || !row) return;
    const r = row.getBoundingClientRect();
    const b = p.getBoundingClientRect();
    // Below the file's sticky header, and above the bottom edge.
    if (r.top < b.top + 32 || r.bottom > b.bottom)
      p.scrollTo({ top: p.scrollTop + r.top - b.top - p.clientHeight * 0.35 });
  }, [current, here]);

  const [hover, setHover] = useState<Hover>();
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stay = () => clearTimeout(leaving.current);
  const leave = () => {
    clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setHover(undefined), 150);
  };
  const onMove = (e: React.PointerEvent) => {
    const id = identifierAt(e.clientX, e.clientY);
    const found = id && valueOf(id.name);
    const rect = id && rangeOf(id.code, id.start, id.end).getBoundingClientRect();
    const inside =
      rect &&
      e.clientX >= rect.left - 1 &&
      e.clientX <= rect.right + 1 &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (!found || !inside) return hover && leave();
    stay();
    const w = wrapper.current!.getBoundingClientRect();
    const box = { left: rect.left - w.left, top: rect.top - w.top, width: rect.width, height: rect.height };
    if (hover?.value !== found.value || hover.box.left !== box.left || hover.box.top !== box.top)
      setHover({ ...found, box });
  };

  // Selecting code asks about it with this step attached.
  const selecting = useAskSelection(wrapper, {
    file: (path) => (path === file.path ? file : undefined),
    around: () => ({ kind: "step", job, step: current }),
  });
  keys.current = selecting.onKey;

  const card = (
    <FileCard
      id={`trace-${current}`}
      file={file}
      visible={visible}
      marked={here !== undefined ? [here, here] : undefined}
      onReveal={reveal}
      wrap={wrap}
      actions={
        <span className="flex flex-none items-center gap-2.5 font-mono text-[11px] text-fg-3">
          {wrap && <span>↳ wrapped</span>}
          <span>line {s.line}</span>
        </span>
      }
      decorate={(i) => {
        const values = inline.get(i);
        const skipped = branches.some((b) => i >= b.from && i <= b.to);
        if (i !== here && !values && !skipped) return undefined;
        return {
          className: skipped ? "opacity-50" : undefined,
          sign: i === here ? <span className="font-semibold text-accent-fg">›</span> : undefined,
          after: values && (
            <span className={cn("text-[11px]", !wrap && "ml-6")}>
              {values.map((v, k) => (
                <span key={k}>
                  {k > 0 && ", "}
                  <Inline v={v} />
                </span>
              ))}
            </span>
          ),
        };
      }}
      gapLabel={(from, to) => {
        const b = branches.find((b) => b.from === from && b.to === to);
        if (!b) return undefined;
        const n = to - from + 1;
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex flex-none items-center gap-1 border border-border bg-surface px-1.5 text-fg-2">
              <Icon paths={icons.branch} size={10} />
              not taken
            </span>
            <span className={cn("min-w-0 text-fg-2 italic", !wrap && "truncate")}>
              <span className="mr-[0.25em] not-italic">{INFERRED}</span>
              <StepText text={b.reason} />
            </span>
            <span className="flex-none">
              {n} line{n === 1 ? "" : "s"}
            </span>
          </span>
        );
      }}
    />
  );

  return (
    <div ref={wrapper} className="relative min-h-0 flex-1" onMouseUp={selecting.onMouseUp}>
      <div
        ref={scroller}
        onPointerMove={onMove}
        onPointerLeave={leave}
        onScroll={() => setHover(undefined)}
        className="absolute inset-0 overflow-y-auto p-3 pt-0"
      >
        {card}
      </div>
      {hover && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute z-20 border border-accent"
            style={{
              left: hover.box.left - 2,
              top: hover.box.top - 1,
              width: hover.box.width + 4,
              height: hover.box.height + 2,
            }}
          />
          <Tip
            anchor={{ left: hover.box.left, top: hover.box.top, bottom: hover.box.top + hover.box.height }}
            container={wrapper.current}
            onPointerEnter={stay}
            onPointerLeave={leave}
          >
            <ValueTip {...hover} current={current} />
          </Tip>
        </>
      )}
      {selecting.chip}
    </div>
  );
}

function ValueTip({ value: v, step, current }: { value: Value; step: number; current: number }) {
  const inferred = v.from === "inferred";
  const [path, line] = (v.at ?? "").split("#L");
  return (
    <div className="flex w-[300px] max-w-full flex-col gap-1.5">
      <span className="flex items-baseline gap-2 font-mono text-xs">
        <span className="font-semibold">{v.name}</span>
        {v.type && <span className="text-fg-3">{v.type}</span>}
      </span>
      <span className="text-[13px] break-words">
        <Val inferred={inferred}>{v.value}</Val>
      </span>
      {inferred && v.reason && (
        <span className="text-[12px] leading-normal text-fg-2">
          <StepText text={v.reason} />
        </span>
      )}
      <span className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px]">
        {inferred ? (
          <span className="border border-dashed border-border-strong px-1.5 text-fg-2 italic">
            {INFERRED} inferred for this scenario
          </span>
        ) : (
          <>
            <span className="border border-border px-1.5 text-fg-2">from the code</span>
            {path && <CiteChip path={path} start={Number(line)} end={Number(line)} />}
          </>
        )}
        {step !== current && <span className="text-fg-3">since step {step + 1}</span>}
      </span>
    </div>
  );
}
