import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/workspace/Icon";
import { INFERRED, packageOf, type Step } from "./trace";

/** Packages that get a color, at most: the rest share one neutral. */
export const COLORED = 6;

/**
 * Each package's color slot, 1-6, or 0 for neutral. The six packages with the most steps get colors, in the order
 * the trace first enters them; code outside the repository is always neutral.
 */
export function packageColors(steps: Pick<Step, "path" | "package">[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const s of steps) if (!s.package) count.set(packageOf(s), (count.get(packageOf(s)) ?? 0) + 1);
  const top = new Set(
    [...count]
      .sort((a, b) => b[1] - a[1])
      .slice(0, COLORED)
      .map(([p]) => p),
  );
  const slots = new Map<string, number>();
  for (const s of steps) {
    const p = packageOf(s);
    if (!slots.has(p)) slots.set(p, top.has(p) && !s.package ? [...slots.values()].filter(Boolean).length + 1 : 0);
  }
  return slots;
}

/** A package's fill and line, as CSS colors. */
export const fill = (slot: number) => `var(--pkg-${slot})`;
export const line = (slot: number) => `var(--pkg-${slot}-line)`;

export function Swatch({ slot, size = 8 }: { slot: number; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex-none border"
      style={{ width: size, height: size, background: fill(slot), borderColor: line(slot) }}
    />
  );
}

/** A value: from the code, plain; inferred, quieter, italic and marked ≈ wherever it appears. */
export function Val({ children, inferred }: { children: string; inferred: boolean }) {
  return (
    <span
      className={cn(
        "font-mono text-[0.92em] whitespace-pre-wrap",
        inferred ? "text-fg-2 italic" : "text-fg not-italic",
      )}
    >
      {inferred && <span className="mr-[0.25em] not-italic">{INFERRED}</span>}
      {children}
    </span>
  );
}

/** A step's sentence or a reason: `≈503` is an inferred value, any other backticks are code. */
export function StepText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) => {
        if (!/^`.+`$/.test(part)) return <Fragment key={i}>{part}</Fragment>;
        const inner = part.slice(1, -1);
        if (inner.startsWith(INFERRED))
          return (
            <Val key={i} inferred>
              {inner.slice(INFERRED.length).trim()}
            </Val>
          );
        return (
          <code key={i} className="border border-border-subtle bg-surface-3 px-0.5 font-mono text-[0.88em]">
            {inner}
          </code>
        );
      })}
    </>
  );
}

/** The note every view of Trace keeps at its top: values are inferred, never observed, and how each looks. */
export function InferredNote({ narrow }: { narrow: boolean }) {
  return (
    <div
      role="note"
      className={cn(
        "flex flex-none gap-x-3.5 gap-y-1 border-b border-border-subtle bg-surface-3 px-3 py-[7px]",
        narrow ? "flex-col" : "items-center",
      )}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2 text-[12.5px] leading-[1.45] text-fg-2">
        <Icon paths={["M2.5 2.5h11v11h-11z", "M8 7v4.5M8 4.6v.5"]} size={14} className="mt-px" />
        Values are inferred from reading the code for this scenario, not observed by running it. They may not be exactly
        right.
      </span>
      <span className={cn("flex flex-none items-center gap-3 text-[11.5px] text-fg-3", narrow && "pl-[22px]")}>
        <span>
          <Val inferred>100 ms</Val> inferred
        </span>
        <span>
          <Val inferred={false}>100 ms</Val> from the code
        </span>
      </span>
    </div>
  );
}

/**
 * Where a tooltip of `size` goes for an anchor, both relative to `box` (the panel): below the anchor, or above when
 * there isn't room below; never past the panel's sides.
 */
export function placeTip(
  anchor: { left: number; top: number; bottom: number },
  box: { width: number; height: number },
  size: { width: number; height: number },
  gap = 6,
): { left: number; top: number } {
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const top =
    below + size.height <= box.height ? below : above >= 0 ? above : Math.max(4, box.height - size.height - 4);
  const left = Math.max(4, Math.min(anchor.left, box.width - size.width - 4));
  return { left, top };
}

/**
 * A tooltip inside a positioned container: measured once rendered, then placed by `placeTip` so it never clips.
 * `anchor` is relative to the container.
 */
export function Tip(props: {
  anchor: { left: number; top: number; bottom: number };
  container: HTMLElement | null;
  children: React.ReactNode;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number }>();
  const { anchor, container } = props;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !container) return;
    setAt(
      placeTip(
        anchor,
        { width: container.clientWidth, height: container.clientHeight },
        { width: el.offsetWidth, height: el.offsetHeight },
      ),
    );
  }, [anchor.left, anchor.top, anchor.bottom, container]);
  return (
    <div
      ref={ref}
      role="tooltip"
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      className={cn(
        "absolute z-30 max-w-[min(340px,calc(100%-8px))] border border-rule bg-surface px-3 py-2.5 shadow-active",
        props.className,
      )}
      style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {props.children}
    </div>
  );
}
