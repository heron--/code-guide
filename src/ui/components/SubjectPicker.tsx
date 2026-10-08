import { useEffect, useState } from "react";
import type { Subject } from "../../shared/protocol";
import { sessionChannel, useSession } from "@/lib/session";

type Suggestion = { subject: Subject; title: string; detail: string };

const describe = (s: Subject) =>
  s.type === "change"
    ? s.pr
      ? `Pull request · #${s.pr}`
      : `Change · ${s.base}...${s.head ?? "working tree"}`
    : s.type === "path"
      ? `Path · ${s.path}`
      : "Question";

/** The first thing a session shows: what to understand. Suggestions make most sessions one click. */
export function SubjectPicker() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>();
  const [input, setInput] = useState("");
  const [parsed, setParsed] = useState<Subject>();
  const [inputError, setInputError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then(setSuggestions, () => setSuggestions([]));
  }, []);
  useEffect(() => {
    // Whatever was read before belongs to other text: never submit it, and drop answers that arrive late.
    setParsed(undefined);
    setInputError(undefined);
    if (!input.trim()) return;
    let current = true;
    const t = setTimeout(() => {
      fetch(`/api/subjects?input=${encodeURIComponent(input)}`)
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error ?? "Could not read subject");
          return body as Subject;
        })
        .then(
          (s) => current && setParsed(s),
          (e: Error) => current && setInputError(e.message),
        );
    }, 150);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [input]);

  // A refused choice (e.g. a pull request that couldn't be fetched) comes back as an error: let them try again.
  const { error } = useSession();
  useEffect(() => {
    if (error) setBusy(false);
  }, [error]);

  const choose = (subject: Subject) => {
    setBusy(sessionChannel().send({ type: "subject.choose", subject }));
  };

  return (
    <div className="flex h-full items-start justify-center overflow-auto bg-canvas px-4 py-16">
      <div className="w-full max-w-[560px] border border-rule bg-surface shadow-active">
        <header className="border-b border-rule bg-surface-3 px-3 py-1.5 text-xs font-semibold">New session</header>
        <div className="flex flex-col gap-5 p-5">
          <h1 className="text-xl font-semibold tracking-tight">What do you want to understand?</h1>
          {(inputError || error) && <p className="text-[12.5px] text-del">{inputError || error}</p>}
          {suggestions === undefined ? (
            <p className="font-mono text-xs text-fg-3">Looking for changes…</p>
          ) : (
            suggestions.length > 0 && (
              <ul className="flex flex-col gap-1.5" aria-label="Suggestions">
                {suggestions.map((s) => (
                  <li key={s.title}>
                    <button
                      disabled={busy}
                      onClick={() => choose(s.subject)}
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
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed && input.trim()) choose(parsed);
            }}
          >
            <label htmlFor="subject-input" className="text-xs text-fg-2">
              Or a path, a branch, a pull request link, a question, or a range ({""}
              <span className="font-mono">main...feature</span>)
            </label>
            <div className="flex gap-2">
              <input
                id="subject-input"
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="How are retries scheduled?"
                className="min-w-0 flex-1 border border-border bg-surface px-2.5 py-2 text-[13.5px] placeholder:text-fg-4 focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={!parsed || busy}
                className="border border-accent bg-accent px-3 text-[13px] text-surface disabled:border-border disabled:bg-surface-3 disabled:text-fg-3"
              >
                Start
              </button>
            </div>
            <p className="h-4 font-mono text-[11px] text-fg-3">{parsed && input.trim() ? describe(parsed) : ""}</p>
          </form>
        </div>
      </div>
    </div>
  );
}
