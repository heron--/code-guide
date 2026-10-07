import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ResolvedFile } from "../../shared/guide";
import { unavailable, type ModuleInfo } from "../../shared/modules";
import type { SessionState } from "../../shared/state";
import { panelFor } from "@/lib/panels";
import type { SessionChannel } from "@/lib/session";
import { usePersistent, usePersistentSet } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { Icon, icons } from "./Icon";
import { ActionsContext, type LineShower, type LinesTarget, type WorkspaceActions } from "./actions";
import { Dock } from "./Dock";
import { FileView } from "./FileView";
import {
  discard,
  dropFromDock,
  dropTarget,
  emptyLayout,
  jobStarted,
  markSeen,
  open,
  setSplit,
  slotOf,
  swap,
  toDock,
  toggleMaximized,
  type Layout,
  type Slot,
} from "./layout";
import { jobLabel, panelState, sessionActivity } from "./status";

type Props = {
  state: SessionState;
  modules: ModuleInfo[];
  channel: SessionChannel;
  /** A lost connection or a refused request, shown in the status bar. */
  problem?: string;
};

/** The frame every module lives in: a status bar, two slots, and (below) the dock. No navigation rail. */
export function Workspace({ state, modules, channel, problem }: Props) {
  const [stored, setLayout] = usePersistent<Layout>(`cg:${state.id}:layout`, emptyLayout);
  const layout = { ...emptyLayout, ...stored };
  const byName = (name?: string) => modules.find((m) => m.name === name);

  // Every new job puts its module in the dock (never in a slot), and a panel in a slot has seen its result.
  useEffect(() => {
    let next = layout;
    for (const id of state.jobOrder) {
      const m = byName(state.jobs[id].module);
      if (m?.needsJob) next = jobStarted(next, id, m.name);
    }
    for (const s of ["left", "right"] as const) {
      const m = byName(next[s]);
      const job = m && panelState(m, state).job;
      if (m && job) next = markSeen(next, m.name, job);
    }
    if (next !== layout) setLayout(next);
  });

  // Citations: show lines in the Guide if its chapter has the file, else in the Diff (for changed files),
  // else in a plain file view over the workspace.
  const showers = useRef(new Map<string, LineShower>());
  const pending = useRef<{ module: string; target: LinesTarget }>(undefined);
  const latestCite = useRef(0);
  const [fileView, setFileView] = useState<{ target: LinesTarget; file: ResolvedFile }>();
  const live = useRef({ layout, state, modules });
  live.current = { layout, state, modules };
  const actions = useMemo<WorkspaceActions>(() => {
    const inSlot = (m: string) => !!slotOf(live.current.layout, m);
    const elsewhere = (): Slot => (live.current.layout.recent === "left" ? "right" : "left");
    return {
      register(module, shower) {
        showers.current.set(module, shower);
        if (pending.current?.module === module) {
          shower.show(pending.current.target);
          pending.current = undefined;
        }
        return () => {
          if (showers.current.get(module) === shower) showers.current.delete(module);
        };
      },
      async showLines(target) {
        // Only the latest citation clicked may move the workspace.
        const ticket = ++latestCite.current;
        const guide = showers.current.get("guide");
        if (guide && inSlot("guide") && guide.canShow(target.path)) return guide.show(target);
        const res = await fetch(`/api/file?path=${encodeURIComponent(target.path)}`);
        if (!res.ok || ticket !== latestCite.current) return;
        const file = (await res.json()) as ResolvedFile;
        if (ticket !== latestCite.current) return;
        const diff = live.current.modules.find((m) => m.name === "diff");
        if (file.status !== "unchanged" && diff && !unavailable(diff, live.current.state)) {
          const shower = showers.current.get("diff");
          if (shower && inSlot("diff")) {
            // A Diff loaded before the file changed doesn't have it; the file view does.
            if (shower.canShow(target.path)) return shower.show(target);
            return setFileView({ target, file });
          }
          pending.current = { module: "diff", target };
          setLayout(open(live.current.layout, "diff", elsewhere()));
          return;
        }
        setFileView({ target, file });
      },
      ask: () => {},
    };
  }, [setLayout]);

  const startModule = (m: ModuleInfo) => {
    if (m.needsJob) channel.send({ type: "job.start", module: m.name });
    else setLayout(open(layout, m.name));
  };

  // Dragging: a dock square into the workspace, or a panel's title bar onto the other slot.
  const mainRef = useRef<HTMLElement>(null);
  const [drag, setDrag] = useState<Drag>();
  const dragged = useRef(false);
  const startDrag = (panel: string, from: Drag["from"], e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragged.current = false;
    setDrag({ panel, from, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
  };
  const over = drag && dragOver(drag, mainRef.current, layout);
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) dragged.current = true;
      setDrag({ ...drag, x: e.clientX, y: e.clientY });
    };
    // The click that follows a drag must not also restore the square; after that, clicks (and keys) work again.
    const end = () => {
      setDrag(undefined);
      setTimeout(() => (dragged.current = false));
    };
    const up = () => {
      const target = dragged.current ? dragOver(drag, mainRef.current, layout) : undefined;
      if (target) setLayout(target.layout);
      end();
    };
    const cancel = (e: KeyboardEvent) => e.key === "Escape" && end();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", cancel);
    };
  });
  const shown = over && dragged.current ? over.layout : layout;
  const dropAt = over && dragged.current ? over.slot : undefined;
  const draggedModule = drag && byName(drag.panel);

  const slot = (s: Slot) => {
    if (dropAt === s && draggedModule) return <DropZone module={draggedModule} slot={over!.whole ? undefined : s} />;
    const m = byName(shown[s]);
    if (!m) return <EmptySlot slot={s} state={state} modules={modules} />;
    return (
      <PanelFrame
        module={m}
        active={shown.recent === s}
        maximized={shown.maximized === s}
        onFocus={() => layout.recent !== s && setLayout({ ...layout, recent: s })}
        onMaximize={() => setLayout(toggleMaximized(layout, s))}
        onClose={() => setLayout(toDock(layout, s))}
        onDragStart={(e) => startDrag(m.name, s, e)}
      >
        <PanelBody module={m} state={state} channel={channel} />
      </PanelFrame>
    );
  };

  return (
    <ActionsContext.Provider value={actions}>
      <div
        className={cn(
          "relative flex h-full flex-col overflow-hidden bg-canvas text-fg",
          drag && dragged.current && "cursor-grabbing select-none",
        )}
      >
        <StatusBar state={state} modules={modules} onStart={startModule} problem={problem} />
        <main ref={mainRef} className="flex min-h-0 flex-1 p-2.5">
          {over?.whole && dragged.current ? (
            slot("left")
          ) : shown.maximized ? (
            slot(shown.maximized)
          ) : (
            <Slots
              split={shown.split}
              onSplit={(v) => setLayout(setSplit(layout, v))}
              left={slot("left")}
              right={slot("right")}
            />
          )}
        </main>
        <Dock
          state={state}
          modules={modules}
          layout={layout}
          dragging={drag?.from === "dock" && dragged.current ? drag.panel : undefined}
          onDragStart={(p, e) => startDrag(p, "dock", e)}
          onOpen={(p) => !dragged.current && setLayout(open(layout, p))}
          onDiscard={(p) => setLayout(discard(layout, p))}
          onRetry={(module, job) => channel.send({ type: "job.start", module, retry: job })}
        />
        {drag && dragged.current && draggedModule && drag.from === "dock" && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-50 flex h-[50px] w-[54px] flex-col items-center justify-center gap-[5px] border border-accent bg-surface shadow-active"
            style={{ left: drag.x - 27, top: drag.y - 25 }}
          >
            <Icon paths={draggedModule.icon} className="text-fg-2" />
            <span className="font-mono text-[10px]">{draggedModule.label}</span>
          </div>
        )}
        {fileView && <FileView {...fileView} onClose={() => setFileView(undefined)} />}
      </div>
    </ActionsContext.Provider>
  );
}

type Drag = { panel: string; from: "dock" | Slot; x: number; y: number; x0: number; y0: number };

/** Where a drag would drop, and the layout it would make: the preview shown while dragging. */
function dragOver(
  drag: Drag,
  main: HTMLElement | null,
  l: Layout,
): { slot: Slot; layout: Layout; whole: boolean } | undefined {
  const r = main?.getBoundingClientRect();
  if (!r || drag.x < r.left || drag.x > r.right || drag.y < r.top || drag.y > r.bottom) return undefined;
  const half: Slot = drag.x < r.left + r.width * (l.left && l.right ? l.split : 0.5) ? "left" : "right";
  if (drag.from === "dock") {
    const slot = dropTarget(l, half);
    return { slot, layout: dropFromDock(l, drag.panel, slot), whole: !l.left && !l.right };
  }
  // A title bar only swaps onto the other slot. Panels go to the dock with ×, not by dragging.
  if (half === drag.from || l.maximized) return undefined;
  return { slot: half, layout: swap(l), whole: false };
}

/** A crisp outline where the panel will land. */
function DropZone({ module: m, slot }: { module: ModuleInfo; slot?: Slot }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center border-2 border-accent bg-accent-bg">
      <div className="flex flex-col items-center gap-2 text-center">
        <Icon paths={m.icon} size={20} className="text-accent-fg" />
        <span className="text-[13px] font-semibold text-accent-fg">Open {m.label} here</span>
        <span className="font-mono text-[11px] text-accent-fg">
          {slot ? `${slot} slot` : "workspace"} · release to drop
        </span>
      </div>
    </div>
  );
}

function Slots({
  split,
  onSplit,
  left,
  right,
}: {
  split: number;
  onSplit: (v: number) => void;
  left: ReactNode;
  right: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const r = ref.current!.getBoundingClientRect();
      onSplit((e.clientX - r.left) / r.width);
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, onSplit]);

  return (
    <div ref={ref} className={cn("flex min-w-0 flex-1", dragging && "cursor-col-resize select-none")}>
      <div className="flex min-w-0" style={{ flex: `${split} 1 0` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize slots"
        tabIndex={0}
        onPointerDown={() => setDragging(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSplit(split - 0.05);
          if (e.key === "ArrowRight") onSplit(split + 0.05);
        }}
        className="flex w-[9px] flex-none cursor-col-resize items-center justify-center focus-visible:outline-1 focus-visible:outline-accent"
      >
        <span className="h-7 w-[3px] border-x border-border" />
      </div>
      <div className="flex min-w-0" style={{ flex: `${1 - split} 1 0` }}>
        {right}
      </div>
    </div>
  );
}

function PanelFrame(props: {
  module: ModuleInfo;
  active: boolean;
  maximized: boolean;
  onFocus: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  children: ReactNode;
}) {
  const { module: m, active } = props;
  return (
    <section
      aria-label={m.label}
      onPointerDownCapture={props.onFocus}
      onFocusCapture={props.onFocus}
      className={cn(
        "relative flex min-w-0 flex-1 flex-col bg-surface",
        active ? "border border-rule shadow-active" : "border border-border-strong",
      )}
    >
      <header
        onPointerDown={(e) => (e.target as HTMLElement).closest("button") === null && props.onDragStart(e)}
        className={cn(
          "flex h-7 flex-none cursor-grab touch-none items-center gap-[7px] pr-[5px] pl-[9px]",
          active ? "border-b border-rule bg-surface-3" : "border-b border-border-strong bg-surface-4",
        )}
      >
        <Icon paths={m.icon} size={13} className="text-fg-2" />
        <span className="text-xs font-semibold">{m.label}</span>
        <span className="flex-1" />
        <TitleButton
          label={props.maximized ? "Restore" : "Maximize"}
          onClick={props.onMaximize}
          paths={icons.maximize}
        />
        <TitleButton label="Send to dock" onClick={props.onClose} paths={icons.close} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{props.children}</div>
    </section>
  );
}

function TitleButton({ label, onClick, paths }: { label: string; onClick: () => void; paths: string[] }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-[18px] items-center justify-center border border-border bg-surface text-fg-2 hover:border-fg-3 hover:text-fg"
    >
      <Icon paths={paths} size={10} />
    </button>
  );
}

/** A module's own panel, or a placeholder until its module has one. */
function PanelBody({
  module: m,
  state,
  channel,
}: {
  module: ModuleInfo;
  state: SessionState;
  channel: SessionChannel;
}) {
  const Panel = panelFor(m.name);
  const { job, busy, activity, stage, failed } = panelState(m, state);
  const retry = () => failed && channel.send({ type: "job.start", module: m.name, retry: failed.id });
  // A failed job shows here as well as in the dock, with its retry, when the panel is in a slot.
  if (m.needsJob && failed && !job)
    return (
      <Centered title={`Couldn't finish the ${m.label.toLowerCase()}`}>
        <span className="block">{jobLabel(failed)} failed:</span>
        <span className="block text-del">{failed.error}</span>
        <span className="mt-1 block">It shows here once all its jobs are done. Retry picks up from this one.</span>
        <span className="mt-3 block">
          <RetryButton onClick={retry} />
        </span>
      </Centered>
    );
  if (m.needsJob && !job)
    return (
      <Centered title={busy ? `${stage ?? `Writing ${m.label.toLowerCase()}`}…` : `No ${m.label.toLowerCase()} yet`}>
        {activity}
      </Centered>
    );
  if (!Panel) return <Centered title={`${m.label} panel`}>This module's panel isn't built yet.</Centered>;
  const panel = (
    <Suspense fallback={<Centered title="Loading…" />}>
      <Panel module={m} state={state} channel={channel} job={job} />
    </Suspense>
  );
  if (!failed) return panel;
  // A later run failed: keep showing the earlier result, under the failure.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-rule bg-del-bg px-3 py-1.5 text-[12.5px]">
        <span className="min-w-0 flex-1 truncate text-del" title={failed.error}>
          {jobLabel(failed)} failed: {failed.error}
        </span>
        <RetryButton onClick={retry} />
      </div>
      {panel}
    </div>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-7 flex-none items-center gap-1.5 border border-border bg-surface px-3 text-[12.5px] text-fg hover:border-fg-3"
    >
      <Icon paths={icons.retry} size={12} />
      Retry
    </button>
  );
}

function EmptySlot({ slot, state, modules }: { slot: Slot; state: SessionState; modules: ModuleInfo[] }) {
  const guide = modules.find((m) => m.name === "guide");
  const writing = slot === "left" && guide && panelState(guide, state).busy && !panelState(guide, state).job;
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center border border-dashed border-border">
      {writing ? (
        <Centered title="Your guide is being written">
          It will wait in the dock below, marked when it’s ready. Nothing opens on its own.
        </Centered>
      ) : (
        <Centered title="Empty slot">Open Chat or Diff from New panel, or drag a square up from the dock.</Centered>
      )}
    </div>
  );
}

function Centered({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="m-auto flex max-w-[300px] flex-col items-center gap-2 p-4 text-center">
      <span className="text-[13px] font-medium text-fg-2">{title}</span>
      {children && <span className="text-[12.5px] leading-normal text-fg-3">{children}</span>}
    </div>
  );
}

function StatusBar({
  state,
  modules,
  onStart,
  problem,
}: {
  state: SessionState;
  modules: ModuleInfo[];
  onStart: (m: ModuleInfo) => void;
  problem?: string;
}) {
  const subject = state.subject?.subject;
  const activity = sessionActivity(state);
  const guide = modules.find((m) => m.name === "guide");
  const guideJob = guide && panelState(guide, state).job;
  return (
    <div className="relative z-20 flex h-[30px] flex-none items-center gap-3.5 border-b border-rule bg-chrome pr-2 pl-3 text-xs whitespace-nowrap">
      <div className="flex min-w-0 flex-1 items-center gap-3.5 overflow-hidden">
        <span className="flex items-center gap-[7px] font-semibold">
          <span className="size-[9px] bg-accent" />
          Code Guide
        </span>
        <Sep />
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px]">
          {subject?.type === "change" && <Icon paths={icons.branch} size={12} className="text-fg-2" />}
          <span className="truncate">{state.subject?.label}</span>
        </span>
        {state.harness && (
          <>
            <Sep />
            <span className="font-mono text-[11.5px] text-fg-2">
              {state.harness.harness} · {state.harness.model}
            </span>
          </>
        )}
        {activity && (
          <>
            <Sep />
            <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-fg-2">
              <span className="size-1.5 animate-pulse bg-accent" />
              {activity}
            </span>
          </>
        )}
        <span className="flex-1" />
      </div>
      {problem && (
        <span role="status" className="max-w-[40%] truncate text-[11.5px] text-del" title={problem}>
          {problem}
        </span>
      )}
      {guideJob ? (
        <ReviewedCount session={state.id} job={guideJob} />
      ) : (
        <span className="font-mono text-[11.5px] text-fg-2">Guide not ready</span>
      )}
      <Sep />
      <NewPanel state={state} modules={modules} onStart={onStart} />
    </div>
  );
}

const Sep = () => <span className="h-3.5 w-px flex-none bg-border" />;

function ReviewedCount({ session, job }: { session: string; job: string }) {
  const [chapters, setChapters] = useState<number>();
  const [reviewed] = usePersistentSet(`cc:${session}:${job}:chapters`);
  useEffect(() => {
    fetch(`/api/results/${encodeURIComponent(job)}`)
      .then((r) => r.json())
      .then(
        (g: { chapters?: unknown[] }) => setChapters(g.chapters?.length),
        () => {},
      );
  }, [job]);
  if (chapters === undefined) return null;
  return (
    <span className="flex items-center gap-2 font-mono text-[11.5px] text-fg-2">
      <span className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: chapters }, (_, i) => (
          <span
            key={i}
            className={cn("size-[7px] border", reviewed.has(String(i)) ? "border-accent bg-accent" : "border-border")}
          />
        ))}
      </span>
      {[...reviewed].filter((c) => Number(c) < chapters).length}/{chapters} chapters reviewed
    </span>
  );
}

function NewPanel({
  state,
  modules,
  onStart,
}: {
  state: SessionState;
  modules: ModuleInfo[];
  onStart: (m: ModuleInfo) => void;
}) {
  const [openMenu, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openMenu) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openMenu]);
  return (
    <div ref={ref} className="relative">
      <button
        aria-label="New panel"
        aria-expanded={openMenu}
        onClick={() => setOpen(!openMenu)}
        className="flex h-[22px] items-center gap-[5px] border border-border bg-surface pr-[7px] pl-[5px] text-xs hover:border-fg-3"
      >
        <Icon paths={icons.plus} size={12} />
        New panel
      </button>
      {openMenu && (
        <ul role="menu" className="absolute top-7 right-0 z-30 w-64 border border-rule bg-surface py-1 shadow-active">
          {modules.map((m) => {
            const why = unavailable(m, state);
            return (
              <li key={m.name} role="none">
                <button
                  role="menuitem"
                  disabled={!!why}
                  onClick={() => {
                    onStart(m);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-accent-bg disabled:hover:bg-transparent"
                >
                  <Icon paths={m.icon} size={14} className={why ? "text-fg-4" : "text-fg-2"} />
                  <span className="flex min-w-0 flex-col">
                    <span className={cn("text-[12.5px]", why && "text-fg-3")}>{m.label}</span>
                    <span className="text-[11px] text-fg-3">
                      {why ?? (m.needsJob ? "Runs a job, then waits in the dock" : "Opens now")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
