import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Guide, ResolvedFile } from "../../shared/guide";
import type { ChatContext } from "../../shared/protocol";
import type { ChatMessage } from "../../shared/state";
import { shortPackage, type Trace } from "../trace/trace";
import { RichText } from "@/components/RichText";
import type { PanelProps } from "@/lib/panels";
import { cn } from "@/lib/utils";
import { useDraft } from "@/workspace/actions";
import { Icon, icons } from "@/workspace/Icon";

const chatIcon = ["M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Finished guides and traces, fetched once, for naming chapters and steps in context labels. */
const results = new Map<string, Promise<unknown>>();
/** The session `results` belong to: a restarted server numbers its jobs from 1 again while this tab stays open. */
let resultsFor: string | undefined;
function useResult<T>(job?: string): T | undefined {
  const [r, setR] = useState<T>();
  useEffect(() => {
    if (!job) return;
    if (!results.has(job))
      results.set(
        job,
        fetch(`/api/results/${encodeURIComponent(job)}`).then((r) => r.json()),
      );
    let current = true;
    results.get(job)!.then((x) => current && setR(x as T));
    return () => {
      current = false;
    };
  }, [job]);
  return r;
}

function ContextLabel({ c }: { c: ChatContext }) {
  const result = useResult<Guide & Trace>(c.kind === "code" ? undefined : c.job);
  if (c.kind === "code")
    return (
      <>{`${c.path.split("/").pop()} ${c.start === c.end ? c.start : `${c.start}–${c.end}`}${c.side === "old" ? " (removed)" : ""}`}</>
    );
  if (c.kind === "step") {
    const s = result?.steps?.[c.step];
    return <>{`About Trace · step ${c.step + 1}${s ? ` · ${shortPackage(s)} ${s.function}` : ""}`}</>;
  }
  const title = result?.chapters?.[c.chapter]?.title;
  return <>{`${c.kind === "prose" ? "From" : "About"} ${pad(c.chapter + 1)}${title ? ` · ${title}` : ""}`}</>;
}

/** The code a context points at, as a few numbered lines. */
function CodeLines({ c }: { c: Extract<ChatContext, { kind: "code" }> }) {
  const [file, setFile] = useState<ResolvedFile>();
  useEffect(() => {
    fetch(`/api/file?path=${encodeURIComponent(c.path)}`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then(setFile, () => {});
  }, [c.path]);
  // Removed lines are numbered on the old side; everything else on the new.
  const num = (l: ResolvedFile["lines"][number]) => (c.side === "old" ? l.k !== "+" && l.o : l.k !== "-" && l.n);
  const lines = file?.lines
    .filter((l) => {
      const n = num(l);
      return !!n && n >= c.start && n <= c.end;
    })
    .slice(0, 12);
  if (!lines?.length) return null;
  return (
    <div className="overflow-x-auto font-mono text-[11.5px]">
      {lines.map((l) => (
        <div
          key={`${l.o}:${l.n}`}
          className={cn("flex h-5 min-w-max leading-5", l.k === "+" && "bg-add-bg", l.k === "-" && "bg-del-bg")}
        >
          <span className="w-9 flex-none pr-2 text-right text-[11px] text-fg-3">{num(l)}</span>
          <span className="pr-3 whitespace-pre">
            {l.t.map(([t, lc, dc], i) =>
              lc ? (
                <span key={i} className="tok" style={{ "--l": lc, "--d": dc } as React.CSSProperties}>
                  {t}
                </span>
              ) : (
                <span key={i}>{t}</span>
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function ContextCard({ c, onRemove }: { c: ChatContext; onRemove?: () => void }) {
  return (
    <div className="border border-border bg-surface">
      <div className="flex h-[26px] items-center gap-1.5 border-b border-border-subtle bg-surface-3 pr-1 pl-2 font-mono text-[11px] text-fg-2">
        <span className="min-w-0 flex-1 truncate">
          <ContextLabel c={c} />
        </span>
        {onRemove && (
          <button
            aria-label="Remove context"
            onClick={onRemove}
            className="flex size-[18px] items-center justify-center hover:text-fg"
          >
            <Icon paths={icons.close} size={10} />
          </button>
        )}
      </div>
      {c.kind === "code" && <CodeLines c={c} />}
      {c.kind === "prose" && <p className="px-2.5 py-1.5 text-[12.5px] leading-normal text-fg-2 italic">“{c.text}”</p>}
    </div>
  );
}

/** How close to the bottom, in px, still counts as at the bottom. */
const FOLLOW_SLACK = 40;

/** The Chat module: questions as they come up, answered from the code with citations. */
export default function ChatPanel({ state, channel }: PanelProps) {
  if (resultsFor !== state.id) {
    results.clear();
    resultsFor = state.id;
  }
  const { context, setContext } = useDraft();
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const messages = state.chat;
  const last = messages.at(-1);
  const waiting = last?.from === "reader" || last?.status === "streaming";

  // Follow the conversation as it grows, but only while the reader is at the bottom: scrolling up to reread
  // stops it, and scrolling back down or sending a message resumes it. Only scrolling updates this, so a reply
  // growing below the fold doesn't count as the reader leaving the bottom.
  const following = useRef(true);
  const onScroll = () => {
    const el = scroller.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK;
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
    // Any reply can still be streaming, not only the last message, so watch the length of them all.
  }, [messages.length, messages.reduce((n, m) => n + m.text.length, 0)]);

  const send = () => {
    if (!text.trim()) return;
    if (channel.send({ type: "chat.send", text: text.trim(), context })) {
      following.current = true;
      setText("");
      setContext([]);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end gap-[18px] px-4 pt-4 pb-2">
          {messages.length === 0 && (
            <p className="m-auto max-w-[280px] text-center text-[12.5px] leading-normal text-fg-3">
              Ask anything about the code. Select lines in the Guide, Trace or Diff, or prose in the Guide, or use an
              Ask button, to attach them.
            </p>
          )}
          {messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
        </div>
      </div>
      <div className="flex-none border-t border-border-subtle bg-surface p-3 pr-[21px]">
        <div className="flex flex-col gap-2 border border-accent p-2 shadow-[0_0_0_1px_var(--accent)]">
          {context.map((c, i) => (
            <ContextCard key={i} c={c} onRemove={() => setContext(context.filter((_, j) => j !== i))} />
          ))}
          <label className="sr-only" htmlFor="chat-input">
            Message
          </label>
          <textarea
            id="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={state.subject?.subject.type === "change" ? "Ask about this change…" : "Ask about this code…"}
            className="min-h-10 resize-none bg-transparent text-[13.5px] leading-normal outline-none placeholder:text-fg-4"
          />
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] text-fg-3">
              {waiting ? "Answering…" : "Select code in the Guide or Trace to attach it"}
            </span>
            <span className="flex-1" />
            <button
              aria-label="Send"
              onClick={send}
              disabled={!text.trim()}
              className="flex size-[26px] items-center justify-center border border-accent bg-accent text-surface disabled:border-border disabled:bg-surface-3 disabled:text-fg-4"
            >
              <Icon paths={["M3 8h9M8 4l4 4-4 4"]} size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  const label: ReactNode = m.from === "reader" ? m.context.length ? <ContextLabel c={m.context[0]} /> : "you" : "agent";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-fg-3">
        <Icon paths={m.from === "reader" ? chatIcon : ["M3 3h10v10H3z", "M6 7v.5M10 7v.5M6 10.5h4"]} size={11} />
        <span className="truncate">{label}</span>
      </div>
      {m.from === "reader" ? (
        <div className="flex flex-col gap-2">
          {m.context
            .filter((c) => c.kind !== "chapter" && c.kind !== "step")
            .map((c, i) => (
              <ContextCard key={i} c={c} />
            ))}
          <div className="border border-border-subtle bg-surface-3 px-3 py-[9px] text-[13.5px] leading-normal whitespace-pre-wrap">
            {m.text}
          </div>
        </div>
      ) : (
        <div>
          {m.text ? <RichText text={m.text} /> : <span className="text-[13px] text-fg-3">…</span>}
          {m.status === "streaming" && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle" />
          )}
          {m.status === "failed" && <p className="mt-1 text-[12.5px] text-del">{m.error}</p>}
        </div>
      )}
    </div>
  );
}
