import { useEffect, useRef, useState } from "react";
import type { Subject } from "../../shared/protocol";
import { shortRef } from "../../shared/subjects";
import { sessionChannel, useSession } from "@/lib/session";

type Suggestion = { subject: Subject; title: string; detail: string };

const describe = (s: Subject) =>
  s.type === "change"
    ? s.pr
      ? `Pull request · #${s.pr}`
      : `Change · ${shortRef(s.base)}...${s.head ? shortRef(s.head) : "working tree"}`
    : s.type === "path"
      ? `Path · ${s.path}`
      : "Question";

const inputClass =
  "min-w-0 w-full border border-border bg-surface px-2.5 py-2 text-[13.5px] placeholder:text-fg-4 focus:border-accent focus:outline-none disabled:opacity-60";

/** The first thing a session shows: what to understand. Suggestions make most sessions one click. */
export function SubjectPicker() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [question, setQuestion] = useState("");
  const [inputError, setInputError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const pending = useRef<AbortController | null>(null);
  // The subject being started: a change fetches from its remote first, which can take seconds.
  const [starting, setStarting] = useState<Subject>();
  const busy = checking || starting !== undefined;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/subjects", { signal: controller.signal })
      .then((r) => r.json())
      .then(
        (s: Suggestion[]) => !controller.signal.aborted && setSuggestions(s),
        () => !controller.signal.aborted && setSuggestions([]),
      );
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, []);

  // A refused choice (e.g. a pull request that couldn't be fetched) comes back as an error: let them try again.
  const { error } = useSession();
  useEffect(() => {
    if (error) setStarting(undefined);
  }, [error]);

  const choose = (subject: Subject) => {
    setInputError(undefined);
    if (sessionChannel().send({ type: "subject.choose", subject })) setStarting(subject);
    else setInputError("Not connected. Try again once the connection is restored.");
  };

  const submit = async () => {
    if (busy) return;
    setInputError(undefined);
    setChecking(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const params = new URLSearchParams({ source, target, question });
      const response = await fetch(`/api/subjects?${params}`, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not read subject");
      if (!controller.signal.aborted) choose(body as Subject);
    } catch (e) {
      if (!controller.signal.aborted) setInputError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  };

  return (
    <div className="flex h-full items-start justify-center overflow-auto bg-canvas px-4 py-16">
      <div className="w-full max-w-[560px] border border-rule bg-surface shadow-active">
        <header className="border-b border-rule bg-surface-3 px-3 py-1.5 text-xs font-semibold">New session</header>
        <div className="flex flex-col gap-5 p-5">
          <h1 className="text-xl font-semibold tracking-tight">What do you want to understand?</h1>
          {starting ? (
            <p role="status" className="flex items-center gap-1.5 font-mono text-[11.5px] text-fg-2">
              <span className="size-1.5 animate-pulse bg-accent" />
              {starting.type === "change" ? "Fetching the latest commits…" : "Starting…"}
            </p>
          ) : (
            (inputError || error) && (
              <p role="alert" className="text-[12.5px] text-del">
                {inputError || error}
              </p>
            )
          )}
          {suggestions === undefined ? (
            <p className="font-mono text-xs text-fg-3">Looking for changes…</p>
          ) : (
            suggestions.length > 0 && (
              <ul className="flex flex-col gap-1.5" aria-label="Suggestions">
                {suggestions.map((s) => (
                  <li key={s.title}>
                    <button
                      disabled={busy}
                      onClick={() => !busy && choose(s.subject)}
                      className="flex w-full min-w-0 items-baseline gap-3 border border-border bg-surface px-3 py-2.5 text-left hover:border-accent hover:bg-accent-bg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60"
                    >
                      <span className="truncate text-[13.5px] font-medium">{s.title}</span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-3">{s.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
          <form
            className="flex flex-col gap-3"
            aria-busy={busy}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="text-xs text-fg-3">All inputs are optional. Leave them blank to understand the repository.</p>
            <label htmlFor="subject-source" className="text-xs text-fg-2">
              Source
            </label>
            <input
              id="subject-source"
              autoFocus
              disabled={busy}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                if (!e.target.value.trim()) setTarget("");
                setInputError(undefined);
              }}
              placeholder="feature or origin/feature"
              aria-describedby="subject-source-help"
              className={inputClass}
            />
            <p id="subject-source-help" className="text-xs text-fg-3">
              Branch to explain. Without a remote, uses the local branch, then origin if not found locally.
            </p>
            {source.trim() && (
              <>
                <label htmlFor="subject-target" className="text-xs text-fg-2">
                  Target
                </label>
                <input
                  id="subject-target"
                  disabled={busy}
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setInputError(undefined);
                  }}
                  placeholder="Default branch"
                  aria-describedby="subject-target-help"
                  className={inputClass}
                />
                <p id="subject-target-help" className="text-xs text-fg-3">
                  Compare against this branch. Use remote/branch for a remote; otherwise it stays local.
                </p>
              </>
            )}
            <label htmlFor="subject-question" className="text-xs text-fg-2">
              Question
            </label>
            <input
              id="subject-question"
              disabled={busy}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                setInputError(undefined);
              }}
              placeholder="How are retries scheduled?"
              aria-describedby="subject-question-help"
              className={inputClass}
            />
            <p id="subject-question-help" className="text-xs text-fg-3">
              Focus the change, or ask a general question. Without a source, you can also enter a path, a branch, a pull
              request link, or a range (main...feature).
            </p>
            <button
              type="submit"
              disabled={busy}
              className="self-end border border-accent bg-accent px-3 py-2 text-[13px] text-surface disabled:border-border disabled:bg-surface-3 disabled:text-fg-3"
            >
              {checking ? "Checking…" : starting ? "Starting…" : "Start"}
            </button>
            <p role="status" className="h-4 font-mono text-[11px] text-fg-3">
              {checking ? "Checking…" : starting ? describe(starting) : ""}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
