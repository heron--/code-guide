import type { ModuleInfo } from "../../shared/modules";
import type { SessionState } from "../../shared/state";
import { cn } from "@/lib/utils";
import { Icon, icons } from "./Icon";
import type { Layout } from "./layout";
import { panelState } from "./status";

type Props = {
  state: SessionState;
  modules: ModuleInfo[];
  layout: Layout;
  /** The square being dragged out, shown as an empty outline. */
  dragging?: string;
  onDragStart: (panel: string, e: React.PointerEvent) => void;
  onOpen: (panel: string) => void;
  onDiscard: (panel: string) => void;
  onRetry: (module: string, job: string) => void;
};

/** How far along a running job looks, from the work it has reported: never quite full until it's done. */
function progress(state: SessionState, module: string): number {
  const running = state.jobOrder
    .map((id) => state.jobs[id])
    .filter((j) => j.module === module && j.status === "running");
  const steps = running.reduce((n, j) => n + j.steps, 0);
  return running.length ? 0.08 + 0.84 * (1 - Math.exp(-steps / 12)) : 0.04;
}

/** The strip along the bottom: panels that aren't in a slot, including modules whose job is still running. */
export function Dock({ state, modules, layout, dragging, onDragStart, onOpen, onDiscard, onRetry }: Props) {
  return (
    <div aria-label="Dock" className="flex h-[66px] flex-none items-center gap-2 border-t border-rule bg-chrome px-3.5">
      {layout.dock.map((panel) => {
        const m = modules.find((x) => x.name === panel);
        if (!m) return null;
        if (panel === dragging)
          return (
            <span
              key={panel}
              aria-hidden="true"
              className="h-[50px] w-[54px] flex-none border border-dashed border-border"
            />
          );
        const s = panelState(m, state);
        const ready = !s.busy && !!s.job && layout.seen[panel] !== s.job;
        const status = s.failed
          ? `failed: ${s.failed.error}`
          : s.busy
            ? (s.activity ?? "working…")
            : ready
              ? "ready"
              : undefined;
        return (
          <div key={panel} className="group relative flex-none">
            <button
              aria-label={`${m.label}${status ? `, ${status}` : ""}`}
              title={status ? `${m.label}: ${status}` : m.label}
              onClick={() => onOpen(panel)}
              onPointerDown={(e) => onDragStart(panel, e)}
              className={cn(
                "relative flex h-[50px] w-[54px] flex-col items-center justify-center gap-[5px] border bg-surface",
                s.busy && "pb-1.5",
                s.failed ? "border-del" : "border-border hover:border-fg-3",
              )}
            >
              <Icon paths={m.icon} className={s.failed ? "text-del" : "text-fg-2"} />
              <span className={cn("font-mono text-[10px]", s.failed ? "text-del" : ready ? "text-fg" : "text-fg-2")}>
                {s.failed ? "Failed" : m.label}
              </span>
              {s.busy && (
                <span className="absolute right-1 bottom-1 left-1 h-[3px] border border-border">
                  <span
                    className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-700"
                    style={{ width: `${progress(state, panel) * 100}%` }}
                  />
                </span>
              )}
              {ready && <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 bg-accent" />}
            </button>
            {s.failed && (
              <button
                aria-label={`Retry ${m.label}`}
                title="Retry"
                onClick={() => onRetry(m.name, s.failed!.id)}
                className="absolute -top-2 -left-2 flex size-[18px] items-center justify-center border border-del bg-surface text-del hover:bg-del-bg"
              >
                <Icon paths={icons.retry} size={10} />
              </button>
            )}
            <button
              aria-label={`Discard ${m.label}`}
              title="Discard"
              onClick={() => onDiscard(panel)}
              className="absolute -top-2 -right-2 hidden size-[18px] items-center justify-center border border-border bg-surface text-fg-2 group-focus-within:flex group-hover:flex hover:text-fg"
            >
              <Icon paths={icons.close} size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
