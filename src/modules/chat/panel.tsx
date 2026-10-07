import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseBody, type Guide, type ResolvedFile } from "../../shared/guide";
import type { ChatContext } from "../../shared/protocol";
import type { ChatMessage } from "../../shared/state";
import { CiteChip } from "@/code/CiteChip";
import type { PanelProps } from "@/lib/panels";
import { cn } from "@/lib/utils";
import { useDraft } from "@/workspace/actions";
import { Icon, icons } from "@/workspace/Icon";

const chatIcon = ["M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Finished guides, fetched once, for naming chapters in context labels. */
const guides = new Map<string, Promise<Guide>>();
function useGuide(job?: string): Guide | undefined {
  const [g, setG] = useState<Guide>();
  useEffect(() => {
    if (!job) return;
    if (!guides.has(job))
      guides.set(
        job,
        fetch(`/api/results/${encodeURIComponent(job)}`).then((r) => r.json()),
      );
    let current = true;
    guides.get(job)!.then((x) => current && setG(x));
    return () => {
      current = false;
    };
  }, [job]);
  return g;
}

function ContextLabel({ c }: { c: ChatContext }) {
  const guide = useGuide(c.kind === "code" ? undefined : c.job);
  if (c.kind === "code")
    return (
      <>{`${c.path.split("/").pop()} ${c.start === c.end ? c.start : `${c.start}–${c.end}`}${c.side === "old" ? " (removed)" : ""}`}</>
    );
  const title = guide?.chapters[c.chapter]?.title;
  return <>{`${c.kind === "prose" ? "From" : "About"} ${pad(c.chapter + 1)}${title ? ` · ${title}` : ""}`}</>;
}

/** Inline text with `code` and **bold**. */
function Text({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((t, i) =>
        t.startsWith("`") && t.endsWith("`") && t.length > 1 ? (
          <code key={i} className="border border-border-subtle bg-surface-3 px-0.5 font-mono text-[0.88em]">
            {t.slice(1, -1)}
          </code>
        ) : t.startsWith("**") && t.endsWith("**") && t.length > 3 ? (
          <strong key={i} className="font-semibold">
            {t.slice(2, -2)}
          </strong>
        ) : (
          t
        ),
      )}
    </>
  );
}

/** A reply: paragraphs and list items, with code citations as file:line chips. */
function Reply({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-[13.5px] leading-[1.6]">
      {text
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((para, pi) => {
          const lines = para.split("\n");
          const isList = lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l));
          const render = (src: string, key: number) => (
            <span key={key}>
              {parseBody(src.replace(/^\s*([-*]|\d+\.)\s/, ""))
                .flat()
                .map((part, i) =>
                  part.kind === "anchor" ? (
                    <CiteChip key={i} path={part.path} start={part.range.start} end={part.range.end} />
                  ) : part.kind === "code" ? (
                    <Text key={i} text={`\`${part.text}\``} />
                  ) : (
                    <Text key={i} text={part.text} />
                  ),
                )}
            </span>
          );
          return isList ? (
            <ul key={pi} className="flex list-disc flex-col gap-1 pl-5">
              {lines.map((l, i) => (
                <li key={i}>{render(l, i)}</li>
              ))}
            </ul>
          ) : (
            <p key={pi}>{render(para, 0)}</p>
          );
        })}
    </div>
  );
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

/** The Chat module: questions as they come up, answered from the code with citations. */
export default function ChatPanel({ state, channel }: PanelProps) {
  const { context, setContext } = useDraft();
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const messages = state.chat;
  const last = messages.at(-1);
  const waiting = last?.from === "reader" || last?.status === "streaming";

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, last?.text]);

  const send = () => {
    if (!text.trim()) return;
    if (channel.send({ type: "chat.send", text: text.trim(), context })) {
      setText("");
      setContext([]);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end gap-[18px] px-4 pt-4 pb-2">
          {messages.length === 0 && (
            <p className="m-auto max-w-[280px] text-center text-[12.5px] leading-normal text-fg-3">
              Ask anything about the code. Select lines in the Guide or Diff, or prose in the Guide, or use its Ask
              button, to attach them.
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
            placeholder="Ask about the code…"
            className="min-h-10 resize-none bg-transparent text-[13.5px] leading-normal outline-none placeholder:text-fg-4"
          />
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] text-fg-3">
              {waiting ? "Answering…" : "Select code in the Guide or Diff to attach it"}
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
          {m.context.some((c) => c.kind !== "chapter") &&
            m.context.filter((c) => c.kind !== "chapter").map((c, i) => <ContextCard key={i} c={c} />)}
          <div className="border border-border-subtle bg-surface-3 px-3 py-[9px] text-[13.5px] leading-normal whitespace-pre-wrap">
            {m.text}
          </div>
        </div>
      ) : (
        <div>
          {m.text ? <Reply text={m.text} /> : <span className="text-[13px] text-fg-3">…</span>}
          {m.status === "streaming" && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle" />
          )}
          {m.status === "failed" && <p className="mt-1 text-[12.5px] text-del">{m.error}</p>}
        </div>
      )}
    </div>
  );
}
