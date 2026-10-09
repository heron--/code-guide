import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fill, line, Swatch, Tip, COLORED } from "./bits";
import type { Frame, Step } from "./trace";

type Props = {
  steps: Step[];
  frames: Frame[];
  /** The innermost frame at each step. */
  at: number[];
  current: number;
  colors: Map<string, number>;
  onJump: (step: number) => void;
  /** A small overview fitted to a narrow panel: no labels, and a tap anywhere jumps to that step. */
  compact?: boolean;
};

const fileName = (f: Frame) => (f.external ? f.package : f.path.split("/").pop()!);
const fullName = (f: Frame) => (f.external ? f.package : f.path);

/**
 * The call stack as blocks that build up step by step: the horizontal axis is steps, not time; depth stacks up.
 * Calls on the stack now reach the current step; ones that have returned stay in place, faded.
 */
export function CallStack({ steps, frames, at, current, colors, onJump, compact }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<{ frame: number; anchor: { left: number; top: number; bottom: number } }>();

  const n = steps.length;
  const levels = Math.max(1, ...frames.map((f) => f.depth + 1));
  const row = compact ? 7 : Math.max(18, Math.min(42, Math.floor(300 / levels)));
  const block = compact ? 6 : row - (row >= 30 ? 12 : 4);
  const top = compact ? 4 : 18;
  const axis = compact ? 0 : 22;
  const height = top + levels * row + axis;
  const x = (i: number) => (i / n) * width;
  const innermost = at[current];

  const shown = frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.start <= current)
    .map(({ f, i }) => ({ f, i, live: f.end >= current, end: Math.min(f.end, current) }));

  // Ticks every 5 steps, or every 10, 25, 50… when that would crowd them.
  const every = [5, 10, 25, 50, 100].find((k) => x(k) >= 36) ?? 100;
  const ticks = [0, ...Array.from({ length: Math.floor(n / every) }, (_, k) => (k + 1) * every - 1)].filter(
    (t) => t < n - 1 && x(n - 1) - x(t) > 28,
  );
  ticks.push(n - 1);

  return (
    <div
      ref={box}
      className={cn("relative w-full flex-none select-none", compact && "cursor-pointer")}
      style={{ height }}
      onClick={
        compact
          ? (e) => {
              const r = box.current!.getBoundingClientRect();
              onJump(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))));
            }
          : undefined
      }
    >
      {/* The current step, as a band across the stack. */}
      <div
        aria-hidden="true"
        className="absolute border-x border-accent bg-accent-bg/70"
        style={{ left: x(current), width: Math.max(2, x(current + 1) - x(current)), top: top, bottom: axis }}
      />
      {!compact && (
        <span
          aria-hidden="true"
          className="absolute top-0 bg-accent px-1 font-mono text-[10px] leading-4 font-semibold whitespace-nowrap text-surface"
          style={{ left: Math.min(Math.max(0, x(current)), width - 52) }}
        >
          Step {current + 1}
        </span>
      )}
      {shown.map(({ f, i, live, end }) => {
        const slot = colors.get(f.package) ?? 0;
        const w = Math.max(compact ? 2 : 6, x(end + 1) - x(f.start));
        const now = i === innermost;
        return (
          <button
            key={i}
            tabIndex={compact ? -1 : 0}
            aria-label={`${f.function}, ${fullName(f)}, step ${f.start + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              onJump(f.start);
            }}
            onPointerEnter={(e) => {
              if (compact) return;
              const r = e.currentTarget.getBoundingClientRect();
              const b = box.current!.getBoundingClientRect();
              setHover({ frame: i, anchor: { left: r.left - b.left, top: r.top - b.top, bottom: r.bottom - b.top } });
            }}
            onPointerLeave={() => setHover(undefined)}
            onFocus={(e) => {
              if (compact) return;
              const r = e.currentTarget.getBoundingClientRect();
              const b = box.current!.getBoundingClientRect();
              setHover({ frame: i, anchor: { left: r.left - b.left, top: r.top - b.top, bottom: r.bottom - b.top } });
            }}
            onBlur={() => setHover(undefined)}
            className={cn(
              "absolute flex flex-col items-start justify-center overflow-hidden border px-1.5 text-left transition-[width] duration-100 ease-out",
              !live && "text-fg-2",
            )}
            style={{
              left: x(f.start),
              width: w,
              bottom: axis + f.depth * row + (compact ? 0 : 3),
              height: block,
              background: live ? fill(slot) : `color-mix(in srgb, ${fill(slot)} 30%, var(--surface))`,
              borderColor: now
                ? "var(--fg)"
                : live
                  ? line(slot)
                  : `color-mix(in srgb, ${line(slot)} 45%, var(--surface))`,
              boxShadow: now ? "inset 0 0 0 1px var(--fg)" : undefined,
            }}
          >
            {!compact && w >= 26 && (
              <span className={cn("max-w-full truncate font-mono text-xs leading-[15px]", live && "font-semibold")}>
                {f.function}
              </span>
            )}
            {!compact && w >= 90 && block >= 28 && (
              <span className="max-w-full truncate font-mono text-[10px] leading-[13px]">{fileName(f)}</span>
            )}
          </button>
        );
      })}
      {!compact && (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[22px] border-t border-border-subtle">
          {ticks.map((t) => (
            <span
              key={t}
              className={cn(
                "absolute top-1 -translate-x-1/2 font-mono text-[10px]",
                t > current ? "text-fg-4" : "text-fg-3",
              )}
              style={{ left: Math.min(width - 8, Math.max(8, x(t) + x(1) / 2)) }}
            >
              {t + 1}
            </span>
          ))}
        </div>
      )}
      {hover && (
        <Tip anchor={hover.anchor} container={box.current} className="pointer-events-none">
          <FrameTip f={frames[hover.frame]} slot={colors.get(frames[hover.frame].package) ?? 0} />
        </Tip>
      )}
    </div>
  );
}

function FrameTip({ f, slot }: { f: Frame; slot: number }) {
  return (
    <div className="flex w-[300px] max-w-full flex-col gap-1">
      <span className="flex items-center gap-2 font-mono text-xs font-semibold">
        <Swatch slot={slot} size={10} />
        {f.function}
      </span>
      <span className="truncate font-mono text-[10.5px] text-fg-3">{fullName(f)}</span>
      {f.summary && <span className="text-[12.5px] leading-normal">{f.summary}</span>}
      <span className="font-mono text-[10.5px] text-fg-3">
        {f.start === f.end ? `step ${f.start + 1}` : `steps ${f.start + 1}–${f.end + 1}`} · click to jump to step{" "}
        {f.start + 1}
      </span>
    </div>
  );
}

/** Which color each package has: the six with the most steps, then the rest, neutral, grouped. */
export function Legend({ colors }: { colors: Map<string, number> }) {
  const [open, setOpen] = useState(false);
  const colored = [...colors].filter(([, s]) => s > 0).sort((a, b) => a[1] - b[1]);
  const others = [...colors].filter(([, s]) => s === 0).map(([p]) => p);
  return (
    <div className="relative flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 font-mono text-[10.5px] text-fg-3">
      {colored.map(([p, s]) => (
        <span key={p} className="flex items-center gap-[5px]">
          <Swatch slot={s} />
          {p}
        </span>
      ))}
      {others.length === 1 && (
        <span className="flex items-center gap-[5px]">
          <Swatch slot={0} />
          {others[0]}
        </span>
      )}
      {others.length > 1 && (
        <button
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          onBlur={() => setOpen(false)}
          className="flex h-5 items-center gap-[5px] border border-border px-1.5 hover:border-fg-3"
        >
          <Swatch slot={0} />
          {others.length} others
        </button>
      )}
      {open && (
        <div className="absolute top-6 right-0 z-30 flex w-64 flex-col gap-1 border border-rule bg-surface px-3 py-2.5 font-sans text-xs text-fg shadow-active">
          <span className="font-semibold">{others.length} more packages, shown neutral</span>
          {others.map((p) => (
            <span key={p} className="font-mono text-[11px]">
              {p}
            </span>
          ))}
          <span className="mt-1 text-fg-3">Colors go to the {COLORED} packages with the most steps.</span>
        </div>
      )}
    </div>
  );
}
