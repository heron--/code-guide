import { cn } from "@/lib/utils";
import { Icon, icons } from "@/workspace/Icon";
import { packageColors, Swatch } from "./bits";
import type { Scenario } from "./trace";

type Props = {
  /** What the scenarios follow, e.g. "a request"; unknown until they're proposed. */
  follows?: string;
  scenarios?: Scenario[];
  /** The session's subject, as the status bar names it. */
  subject: string;
  /** The scenario job is running: what it's doing. */
  proposing?: { activity?: string };
  /** The scenario job failed. */
  failed?: { error?: string; onRetry: () => void };
  /** A trace is being written for one scenario. */
  writing?: { pick: number; written: number; onCancel: () => void };
  /** A trace failed for one scenario. */
  traceFailed?: { pick: number; error?: string; onRetry: () => void };
  /** Scenarios already traced: picking one shows its trace at once. */
  traced: Set<number>;
  onPick: (n: number) => void;
  /** Propose scenarios again: none were ever proposed, or the reader wants new ones. */
  onPropose: () => void;
};

const short = (p: string) => p.split("/").pop() || p;

/** The first thing Trace shows: scenarios to pick from, and what it's doing while its jobs run. */
export function Picker(props: Props) {
  const { scenarios, writing, proposing } = props;
  const colors = packageColors((scenarios ?? []).flatMap((s) => s.packages.map((p) => ({ path: `${p}/_` }))));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex max-w-[700px] flex-col gap-[18px] px-10 py-9 max-sm:px-4 max-sm:py-5">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-[-0.01em]">Trace {props.follows ?? "a path"}</h2>
          {proposing ? (
            <span className="flex items-center gap-2 font-mono text-[11.5px] text-fg-2" role="status">
              <span className="size-1.5 flex-none animate-pulse bg-accent" />
              {proposing.activity ?? "Starting"} · proposing 2–3 scenarios
            </span>
          ) : (
            scenarios && (
              <p className="text-[13.5px] leading-normal text-fg-2">
                Pick a scenario. Trace follows one path through {props.subject}, hop by hop across files, without
                running anything.
              </p>
            )
          )}
        </div>

        {props.failed && (
          <div className="flex flex-col items-start gap-2 border border-del bg-del-bg px-4 py-3 text-[12.5px]">
            <span className="text-del">Couldn’t propose scenarios: {props.failed.error}</span>
            <RetryButton onClick={props.failed.onRetry} />
          </div>
        )}

        {!scenarios && !proposing && !props.failed && (
          <div className="flex flex-col items-start gap-3 text-[13px] text-fg-2">
            No scenarios yet.
            <button
              onClick={props.onPropose}
              className="flex h-7 items-center border border-accent bg-accent px-3 text-[12.5px] font-medium text-surface"
            >
              Propose scenarios
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {proposing &&
            [46, 34, 40].map((w, i) => (
              <div
                key={i}
                aria-hidden="true"
                className="flex gap-3.5 border border-border-subtle bg-surface px-4 py-3.5"
              >
                <span className="size-4 flex-none border border-border-subtle bg-surface-3" />
                <span className="flex flex-1 flex-col gap-[9px]">
                  {[`${w}%`, "92%", `${w + 24}%`, "38%"].map((width, k) => (
                    <span
                      key={k}
                      className="block animate-pulse border border-border-subtle bg-surface-3"
                      style={{ width, height: k === 0 ? 13 : k === 3 ? 8 : 10 }}
                    />
                  ))}
                </span>
              </div>
            ))}
          {!proposing &&
            scenarios?.map((s, n) => {
              const busy = writing?.pick === n;
              const failed = props.traceFailed?.pick === n ? props.traceFailed : undefined;
              const off = !!writing && !busy;
              return (
                <div
                  key={n}
                  className={cn(
                    "border bg-surface",
                    busy ? "border-rule shadow-active" : "border-border",
                    off && "opacity-60",
                  )}
                >
                  <button
                    onClick={() => props.onPick(n)}
                    disabled={!!writing}
                    aria-keyshortcuts={String(n + 1)}
                    className="flex w-full items-start gap-3.5 px-4 py-3.5 text-left enabled:hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="mt-0.5 flex size-4 flex-none items-center justify-center border border-border font-mono text-[10px] text-fg-2">
                      {n + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-[15px] font-semibold">{s.title}</span>
                      <span className="text-[13.5px] leading-normal text-fg-2">{s.summary}</span>
                      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10.5px] text-fg-3">
                        {s.packages.map((p, k) => (
                          <span key={k} className="flex items-center gap-1.5" title={p}>
                            {k > 0 && <span aria-hidden="true">→</span>}
                            <Swatch slot={colors.get(`${p}`) ?? 0} />
                            {short(p)}
                          </span>
                        ))}
                        <span className="ml-2.5">
                          {props.traced.has(n) && "traced · "}about {s.steps} steps
                        </span>
                      </span>
                    </span>
                    {!writing && <Icon paths={["M6 3.5l4.5 4.5L6 12.5"]} size={12} className="mt-1 text-fg-3" />}
                  </button>
                  {busy && (
                    <div
                      className="mx-4 mb-3.5 ml-[46px] flex flex-col gap-2 border-t border-border-subtle pt-3"
                      role="status"
                    >
                      <span className="flex items-center gap-2 font-mono text-[11.5px] text-fg-2">
                        <span className="size-1.5 flex-none animate-pulse bg-accent" />
                        Writing the trace · {writing.written} step{writing.written === 1 ? "" : "s"} so far
                      </span>
                      <span aria-hidden="true" className="relative block h-[3px] bg-border-subtle">
                        <span
                          className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-700"
                          style={{ width: `${Math.min(95, Math.max(3, (writing.written / s.steps) * 100))}%` }}
                        />
                      </span>
                    </div>
                  )}
                  {failed && (
                    <div className="mx-4 mb-3.5 ml-[46px] flex items-center gap-3 border-t border-border-subtle pt-3 text-[12.5px]">
                      <span className="min-w-0 flex-1 text-del">Couldn’t write the trace: {failed.error}</span>
                      <RetryButton onClick={failed.onRetry} />
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {writing ? (
          <div className="flex items-center gap-3">
            <span className="flex-1 font-mono text-[11px] text-fg-3">
              You can send Trace to the dock; it will be marked when the trace is ready.
            </span>
            <button
              onClick={writing.onCancel}
              className="flex h-7 flex-none items-center border border-border bg-surface px-3 text-[12.5px] hover:border-fg-3"
            >
              Cancel
            </button>
          </div>
        ) : (
          scenarios &&
          !proposing && (
            <span className="font-mono text-[11px] text-fg-3">
              Scenarios are proposed by the session’s agent from the code. Press 1–{scenarios.length} to start.
            </span>
          )
        )}
      </div>
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
