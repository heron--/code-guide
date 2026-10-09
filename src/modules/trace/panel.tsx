import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedFile } from "../../shared/guide";
import type { PanelProps } from "@/lib/panels";
import { usePersistent } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useActions, useLineShower } from "@/workspace/actions";
import { Icon, icons } from "@/workspace/Icon";
import { Kbd } from "@/workspace/Kbd";
import { InferredNote, packageColors, StepText, Swatch } from "./bits";
import { CallStack, Legend } from "./CallStack";
import { Picker } from "./Picker";
import { StepCode } from "./StepCode";
import { callFrames, packageOf, stepTargets, type Scenario, type Scenarios, type Trace } from "./trace";

/** Narrower than this, Code and Stack become tabs. */
const NARROW = 640;

/**
 * A finished result, fetched once per job of a session. Keyed by session too: a restarted server numbers its jobs
 * from 1 again while this tab stays open.
 */
const results = new Map<string, Promise<unknown>>();
function useResult<T>(session: string, job?: string): T | undefined {
  const key = job && `${session}:${job}`;
  const [r, setR] = useState<{ key: string; value: T }>();
  useEffect(() => {
    if (!key) return;
    if (!results.has(key))
      results.set(
        key,
        fetch(`/api/results/${encodeURIComponent(job!)}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      );
    let current = true;
    results.get(key)!.then(
      (value) => current && setR({ key, value: value as T }),
      () => results.delete(key),
    );
    return () => {
      current = false;
    };
  }, [key]);
  return r && r.key === key ? r.value : undefined;
}

/** A file as the subject shows it, fetched once per path for each trace (the subject can move to new commits). */
function useFile(path: string, files: Map<string, Promise<ResolvedFile>>): ResolvedFile | undefined {
  const [f, setF] = useState<ResolvedFile>();
  useEffect(() => {
    if (!files.has(path))
      files.set(
        path,
        fetch(`/api/file?path=${encodeURIComponent(path)}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      );
    let current = true;
    files.get(path)!.then(
      (x) => current && setF(x),
      () => files.delete(path),
    );
    return () => {
      current = false;
    };
  }, [path, files]);
  return f?.path === path ? f : undefined;
}

/**
 * The Trace module: pick a scenario, then step through its path like a debugger, without running anything. Its
 * first job proposes scenarios; picking one runs a second that writes the trace.
 */
export default function TracePanel({ module: m, state, channel, job }: PanelProps) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, []);
  const narrow = width < NARROW;

  const jobs = state.jobOrder.map((id) => state.jobs[id]).filter((j) => j.module === m.name);
  const latest = jobs.findLast((j) => j.kind === m.kind);
  const proposing = latest && (latest.status === "queued" || latest.status === "running") ? latest : undefined;
  // Scenarios being proposed again replace the old ones.
  const from = proposing ? undefined : job;
  const scenarios = useResult<Scenarios>(state.id, from);
  const traces = jobs.filter((j) => j.kind === m.pickKind && j.inputs[0] === from);
  const writing = traces.find((j) => j.status === "queued" || j.status === "running");
  const [open, setOpen] = usePersistent<number | null>(`cg:${state.id}:${from}:open`, null);
  const ofPick = (n: number) => traces.filter((j) => j.pick === n);
  const done = (n: number) => ofPick(n).findLast((j) => j.status === "finished");
  const lastOpen = open === null ? undefined : ofPick(open).at(-1);
  const shown = open === null || lastOpen?.status !== "finished" ? undefined : lastOpen.id;
  const trace = useResult<Trace>(state.id, shown);

  const pick = (n: number) => {
    if (writing) return;
    setOpen(n);
    if (!done(n)) channel.send({ type: "job.start", module: m.name, pick: n });
  };
  const propose = () => channel.send({ type: "job.start", module: m.name });

  // Keys work while focus is inside this panel, so two panels never fight over them. A trace's are its view's.
  const traceKeys = useRef<(e: React.KeyboardEvent) => boolean>(undefined);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
    const n = Number(e.key) - 1;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (!shown && scenarios && plain && n >= 0 && n < scenarios.scenarios.length) pick(n);
    else if (!shown || !traceKeys.current?.(e)) return;
    e.preventDefault();
  };

  let body;
  if (shown && trace && scenarios)
    body = (
      <TraceView
        key={shown}
        job={shown}
        trace={trace}
        narrow={narrow}
        width={width}
        stepKey={`cg:${state.id}:${shown}:step`}
        scenarios={scenarios.scenarios}
        pick={open!}
        traced={new Set(scenarios.scenarios.flatMap((_, n) => (done(n) ? [n] : [])))}
        onPick={pick}
        onAnother={() => setOpen(null)}
        keys={traceKeys}
      />
    );
  else if (shown) body = <div className="m-auto text-[13px] text-fg-2">Loading the trace…</div>;
  else {
    const failedTrace =
      lastOpen && (lastOpen.status === "failed" || lastOpen.status === "cancelled") ? lastOpen : undefined;
    body = (
      <Picker
        follows={scenarios?.follows}
        scenarios={scenarios?.scenarios}
        subject={state.subject?.label ?? "the code"}
        proposing={proposing && { activity: proposing.activity }}
        failed={
          !proposing && latest?.status === "failed"
            ? {
                error: latest.error,
                onRetry: () => channel.send({ type: "job.start", module: m.name, retry: latest.id }),
              }
            : undefined
        }
        writing={
          writing && {
            pick: writing.pick!,
            written: writing.written ?? 0,
            onCancel: () => channel.send({ type: "job.cancel", job: writing.id }),
          }
        }
        traceFailed={
          !writing && failedTrace?.status === "failed"
            ? {
                pick: failedTrace.pick!,
                error: failedTrace.error,
                onRetry: () => channel.send({ type: "job.start", module: m.name, retry: failedTrace.id }),
              }
            : undefined
        }
        traced={new Set(scenarios?.scenarios.flatMap((_, n) => (done(n) ? [n] : [])) ?? [])}
        onPick={pick}
        onPropose={propose}
      />
    );
  }

  return (
    <div
      ref={root}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={(e) =>
        !(e.target as HTMLElement).closest("button,input,a,label") && root.current?.focus({ preventScroll: true })
      }
      className="relative flex min-h-0 flex-1 flex-col outline-none"
    >
      <InferredNote narrow={narrow} />
      {body}
    </div>
  );
}

type ViewProps = {
  job: string;
  trace: Trace;
  narrow: boolean;
  width: number;
  stepKey: string;
  scenarios: Scenario[];
  pick: number;
  traced: Set<number>;
  onPick: (n: number) => void;
  onAnother: () => void;
  /** Set to this view's key handler: true when it handled the key. */
  keys: React.RefObject<((e: React.KeyboardEvent) => boolean) | undefined>;
};

/** Each control's keys: a debugger's, and a letter for keyboards where F-keys are taken. */
const KEYS = {
  back: { label: "Previous step", keys: ["Shift+F10", "P"] },
  over: { label: "Step over", keys: ["F10", "N"] },
  into: { label: "Step into", keys: ["F11", "I"] },
  out: { label: "Step out", keys: ["Shift+F11", "O"] },
} as const;

/** One trace, stepped through: controls, the call stack, the step's sentence, and its code. */
function TraceView(props: ViewProps) {
  const { job, trace, narrow, width, stepKey, scenarios, pick, traced, onPick, onAnother } = props;
  const { steps } = trace;
  const { ask } = useActions();
  const { frames, at } = useMemo(() => callFrames(steps), [steps]);
  const colors = useMemo(() => packageColors(steps), [steps]);
  const [stored, setStep] = usePersistent(stepKey, 0);
  const i = Math.max(0, Math.min(stored, steps.length - 1));
  const s = steps[i];
  const go = (n?: number) => n !== undefined && setStep(n);
  const t = stepTargets(steps, frames, at, i);
  const file = useFile(s.path, useRef(new Map<string, Promise<ResolvedFile>>()).current);
  const [tab, setTab] = useState<"code" | "stack">("code");
  const last = i === steps.length - 1;

  // Citations from Chat that point at lines a step stops at jump to that step: the nearest to this one. Others go
  // on to a panel that can show those lines.
  const stopsAt = (c: { path: string; start: number; end: number }) =>
    steps.flatMap((x, j) => (x.path === c.path && x.line >= c.start && x.line <= c.end ? [j] : []));
  useLineShower("trace", {
    canShow: (_, c) => stopsAt(c).length > 0,
    show: (c) => {
      const near = stopsAt(c).sort((a, b) => Math.abs(a - i) - Math.abs(b - i));
      if (near.length) setStep(near[0]);
    },
  });

  const codeKeys = useRef<(e: React.KeyboardEvent) => boolean>(undefined);
  props.keys.current = (e) => {
    if (codeKeys.current?.(e)) return true;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const key = e.key.length === 1 ? e.key.toUpperCase() : `${e.shiftKey ? "Shift+" : ""}${e.key}`;
    const control = (Object.keys(KEYS) as (keyof typeof KEYS)[]).find((c) =>
      (KEYS[c].keys as readonly string[]).includes(key),
    );
    if (!control) return false;
    go(t[control]);
    return true;
  };

  // Wrapping a narrow excerpt: as many monospace characters as fit beside the gutters.
  const cols = narrow ? Math.max(24, Math.floor((width - 24 - 2 - 42 - 18 - 16) / 7.2)) : undefined;
  const slot = colors.get(packageOf(s)) ?? 0;
  const fileOrPackage = s.package ?? s.path.split("/").pop();
  const returned = frames.filter((f) => f.end < i).length;

  const stack = (
    <CallStack steps={steps} frames={frames} at={at} current={i} colors={colors} onJump={setStep} compact={narrow} />
  );
  const code = file ? (
    <StepCode
      key={i}
      job={job}
      steps={steps}
      frames={frames}
      at={at}
      current={i}
      file={file}
      wrap={cols}
      keys={codeKeys}
    />
  ) : (
    <div className="m-auto text-[13px] text-fg-2">Loading {s.path}…</div>
  );
  const sentence = (
    <p className="text-[13.5px] leading-normal" aria-live="polite">
      <StepText text={s.text} />
    </p>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-border-subtle px-3 py-2">
        <ScenarioMenu scenarios={scenarios} pick={pick} traced={traced} onPick={onPick} onAnother={onAnother} />
        <span className="flex-1" />
        <Control {...KEYS.back} paths={["M3.5 3v10", "M12 3.5L7 8l5 4.5"]} to={t.back} go={go} />
        <span className="mx-[3px] h-[18px] w-px bg-border" />
        <Control
          {...KEYS.over}
          paths={["M2.5 9.5a5.5 5.5 0 0 1 10.6-2", "M13.5 4.5v3.5H10", "M7 13.5h2"]}
          to={t.over}
          go={go}
        />
        <Control {...KEYS.into} paths={["M8 1.5v8", "M5 6.5l3 3 3-3", "M7 13.5h2"]} to={t.into} go={go} />
        <Control {...KEYS.out} paths={["M8 10.5v-8", "M5 5.5l3-3 3 3", "M7 13.5h2"]} to={t.out} go={go} />
        {!narrow && <Position i={i} n={steps.length} className="ml-3" />}
        <button
          onClick={() => ask({ kind: "step", job, step: i })}
          title="Ask about this step in Chat"
          className="ml-2 flex h-7 flex-none items-center gap-1.5 border border-border bg-surface px-[9px] text-xs hover:border-fg-3"
        >
          <Icon paths={["M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"]} size={12} className="text-fg-2" />
          Ask
        </button>
      </div>

      {narrow ? (
        <>
          <div className="flex flex-none items-center gap-2 px-3 py-2">
            <Swatch slot={slot} size={10} />
            <span className="truncate font-mono text-xs font-semibold">{s.function}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg-3">{fileOrPackage}</span>
            <Position i={i} n={steps.length} />
          </div>
          <div role="tablist" className="flex flex-none border-y border-border-subtle bg-surface-3">
            {(["code", "stack"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "h-8 border-r border-border-subtle px-4 text-[12.5px]",
                  tab === k ? "border-b-2 border-b-accent bg-surface font-semibold" : "text-fg-2 hover:text-fg",
                )}
              >
                {k === "code" ? "Code" : "Stack"}
              </button>
            ))}
          </div>
          {tab === "code" ? (
            <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
              <div className="flex-none px-3 py-2.5">{sentence}</div>
              {code}
            </div>
          ) : (
            <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <LiveStack frames={frames} at={at} current={i} colors={colors} onJump={setStep} />
              <span className="text-[12px] leading-normal text-fg-3">
                {returned
                  ? `${returned} call${returned === 1 ? " has" : "s have"} returned. They’re the faded blocks in the overview; tap it to jump to one.`
                  : "Tap the overview to jump to a step."}
              </span>
              <div className="border border-border-subtle p-1.5">{stack}</div>
            </div>
          )}
        </>
      ) : (
        <>
          <section
            aria-label="Call stack"
            className="flex flex-none flex-col gap-2 border-b border-border-subtle px-3.5 pt-3 pb-2"
          >
            <div className="flex items-start gap-4">
              <span className="text-xs font-semibold">Call stack</span>
              <span className="text-xs text-fg-2">
                Faded blocks have returned. Click any block to jump to its step.
              </span>
              <span className="flex-1" />
              <Legend colors={colors} />
            </div>
            {stack}
          </section>
          <div className="flex flex-none items-start gap-3 px-3.5 py-2.5">
            <span className="flex flex-none items-center gap-1.5 border border-border px-2 py-0.5 font-mono text-xs">
              <Swatch slot={slot} />
              {s.function}
            </span>
            {sentence}
          </div>
          {code}
        </>
      )}

      {last && (
        <div className="m-3 mt-0 flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border border-rule bg-surface px-3.5 py-2.5">
          <Icon paths={["M3 8.5l3.5 3.5L13 4.5"]} size={14} className="text-add" />
          <span className="text-[13px] font-semibold">End of trace</span>
          <span className="text-[12.5px] text-fg-2">
            {steps.length} steps across {colors.size} package{colors.size === 1 ? "" : "s"} · {frames.length} call
            {frames.length === 1 ? "" : "s"}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => setStep(0)}
            className="flex h-7 items-center gap-1.5 border border-border bg-surface px-3 text-[12.5px] hover:border-fg-3"
          >
            <Icon paths={icons.retry} size={12} />
            Restart
          </button>
          <button
            onClick={onAnother}
            className="flex h-7 items-center border border-accent bg-accent px-3 text-[12.5px] font-medium text-surface"
          >
            Trace another scenario
          </button>
        </div>
      )}
    </div>
  );
}

function Position({ i, n, className }: { i: number; n: number; className?: string }) {
  return (
    <span className={cn("flex-none font-mono text-xs whitespace-nowrap tabular-nums", className)}>
      Step {i + 1} <span className="text-fg-3">/ {n}</span>
    </span>
  );
}

/** A debugger control, with its shortcut in a tooltip. */
function Control(props: {
  label: string;
  keys: readonly string[];
  paths: string[];
  to?: number;
  go: (n?: number) => void;
}) {
  const disabled = props.to === undefined;
  return (
    <span className="group/ctl relative flex">
      <button
        aria-label={props.label}
        aria-keyshortcuts={props.keys.join(" ")}
        // aria-disabled, not disabled: a disabled button drops focus, and the panel's keys with it.
        aria-disabled={disabled}
        onClick={() => props.go(props.to)}
        className="flex size-7 items-center justify-center border border-border bg-surface text-fg hover:border-fg-3 aria-disabled:pointer-events-none aria-disabled:opacity-40"
      >
        <Icon paths={props.paths} size={15} />
      </button>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none invisible absolute top-[34px] right-0 z-30 flex items-center gap-1.5 border border-rule bg-surface px-2 py-[5px] text-xs whitespace-nowrap text-fg shadow-active",
          !disabled && "group-hover/ctl:visible group-has-focus-visible/ctl:visible",
        )}
      >
        {props.label}
        <Kbd>{props.keys[0].replace("Shift+", "⇧")}</Kbd>
        <span className="text-fg-3">or</span>
        <Kbd>{props.keys[1]}</Kbd>
      </span>
    </span>
  );
}

/** The scenario this trace follows, and a way to another: one already traced shows at once. */
function ScenarioMenu(props: {
  scenarios: Scenario[];
  pick: number;
  traced: Set<number>;
  onPick: (n: number) => void;
  onAnother: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const choose = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
        className="flex h-7 max-w-full min-w-0 items-center gap-2 border border-border bg-surface px-2 text-[12.5px] hover:border-fg-3"
      >
        <span className="flex-none font-mono text-[10.5px] text-fg-3">Scenario</span>
        <span className="truncate">{props.scenarios[props.pick]?.title}</span>
        <Icon paths={["M4.5 6.5L8 10l3.5-3.5"]} size={11} className="text-fg-2" />
      </button>
      {open && (
        <ul role="menu" className="absolute top-8 left-0 z-30 w-72 border border-rule bg-surface py-1 shadow-active">
          {props.scenarios.map((sc, n) => (
            <li key={n} role="none">
              <button
                role="menuitemradio"
                aria-checked={n === props.pick}
                onClick={choose(() => props.onPick(n))}
                className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-accent-bg"
              >
                <span className="mt-px flex size-4 flex-none items-center justify-center border border-border font-mono text-[10px] text-fg-2">
                  {n + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={cn("text-[12.5px]", n === props.pick && "font-semibold")}>{sc.title}</span>
                  <span className="text-[11px] text-fg-3">
                    {n === props.pick ? "Shown now" : props.traced.has(n) ? "Traced" : "Writes a new trace"}
                  </span>
                </span>
              </button>
            </li>
          ))}
          <li role="none" className="mt-1 border-t border-border-subtle pt-1">
            <button
              role="menuitem"
              onClick={choose(props.onAnother)}
              className="w-full px-2.5 py-1.5 text-left text-[12.5px] hover:bg-accent-bg"
            >
              Trace another scenario…
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

/** The calls on the stack now, innermost first, for a narrow panel. */
function LiveStack(props: {
  frames: ReturnType<typeof callFrames>["frames"];
  at: number[];
  current: number;
  colors: Map<string, number>;
  onJump: (n: number) => void;
}) {
  const { frames, current } = props;
  const live = frames.filter((f) => f.start <= current && f.end >= current).sort((a, b) => b.depth - a.depth);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs">
        <span className="font-semibold">Call stack</span>{" "}
        <span className="text-fg-3">live at step {current + 1}, innermost first</span>
      </span>
      {live.map((f, k) => {
        const slot = props.colors.get(f.package) ?? 0;
        const now = k === 0;
        return (
          <button
            key={`${f.start}-${f.depth}`}
            onClick={() => props.onJump(f.start)}
            className={cn(
              "flex flex-col gap-1 border border-l-4 px-3 py-2 text-left",
              now ? "border-rule" : "border-border hover:border-fg-3",
            )}
            style={{ borderLeftColor: `var(--pkg-${slot}-line)`, background: now ? `var(--pkg-${slot})` : undefined }}
          >
            <span className="flex items-baseline gap-2">
              <span className="w-3 flex-none font-mono text-[10.5px] text-fg-3">{f.depth + 1}</span>
              <span className="font-mono text-[12.5px] font-semibold">{f.function}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg-3">
                {f.external ? f.package : f.path}
              </span>
              <span className="flex-none font-mono text-[10.5px] text-fg-3">
                {f.start === current ? "now" : `since ${f.start + 1}`}
              </span>
            </span>
            {now && f.summary && <span className="pl-5 text-[12.5px]">{f.summary}</span>}
          </button>
        );
      })}
    </div>
  );
}
