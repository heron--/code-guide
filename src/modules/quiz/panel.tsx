import { useEffect, useState, type ReactNode } from "react";
import { CiteChip } from "@/code/CiteChip";
import type { PanelProps } from "@/lib/panels";
import { usePersistent } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { Icon } from "@/workspace/Icon";
import type { Quiz } from "./module";

const LETTERS = "ABCDE";

/** Text with `backticked` code. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((t, i) =>
        i % 2 ? (
          <code key={i} className="border border-border-subtle bg-surface-3 px-0.5 font-mono text-[0.88em]">
            {t}
          </code>
        ) : (
          t
        ),
      )}
    </>
  );
}

/** The Quiz module: one question at a time, tap to answer, then why. Answers last only for the session. */
export default function QuizPanel({ state, job }: PanelProps) {
  const [quiz, setQuiz] = useState<Quiz>();
  useEffect(() => {
    if (!job) return;
    fetch(`/api/results/${encodeURIComponent(job)}`)
      .then((r) => r.json())
      .then(setQuiz, () => {});
  }, [job]);
  const key = `cg:${state.id}:${job}`;
  const [answers, setAnswers] = usePersistent<(number | null)[]>(`${key}:answers`, []);
  const [at, setAt] = usePersistent(`${key}:at`, 0);

  if (!quiz) return <p className="m-auto p-6 text-[13px] text-fg-2">Loading…</p>;
  const total = quiz.questions.length;
  const right = quiz.questions.filter((q, i) => answers[i] != null && q.options[answers[i]!]?.correct).length;
  const answered = answers.filter((a) => a != null).length;

  const header = (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[11.5px] text-fg-2">
        {at < total ? `Question ${at + 1} of ${total}` : "Done"}
      </span>
      <span className="flex gap-[3px]" aria-hidden="true">
        {quiz.questions.map((q, i) => {
          const a = answers[i];
          const state = a == null ? "open" : q.options[a]?.correct ? "right" : "wrong";
          return (
            <button
              key={i}
              tabIndex={-1}
              onClick={() => setAt(i)}
              className={cn(
                "h-1.5 w-[18px] border",
                state === "right" && "border-add bg-add",
                state === "wrong" && "border-del bg-del",
                state === "open" && "border-border bg-surface",
                i === at && "outline-1 outline-offset-1 outline-fg-3",
              )}
            />
          );
        })}
      </span>
      <span className="flex-1" />
      <span className="font-mono text-[11px] text-fg-3">{right} correct</span>
    </div>
  );

  let body: ReactNode;
  if (at >= total) {
    body = (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">
          {right} of {total} right
        </h2>
        <ol className="flex flex-col gap-1.5">
          {quiz.questions.map((q, i) => {
            const ok = answers[i] != null && q.options[answers[i]!]?.correct;
            return (
              <li key={i}>
                <button
                  onClick={() => setAt(i)}
                  className="flex w-full items-start gap-3 border border-border bg-surface px-3 py-2 text-left text-[13.5px] hover:border-fg-3"
                >
                  <span className={cn("font-mono text-[11.5px]", ok ? "text-add" : "text-del")}>
                    {ok ? "Right" : answers[i] == null ? "Skipped" : "Wrong"}
                  </span>
                  <span className="flex-1">
                    <Inline text={q.question} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    );
  } else {
    const q = quiz.questions[at];
    const chosen = answers[at];
    const done = chosen != null;
    const correct = q.options.findIndex((o) => o.correct);
    const [start, end = start] = q.cite.lines.split("-").map(Number);
    body = (
      <div className="flex flex-col gap-[18px]">
        <h2 className="text-lg leading-[1.45] font-semibold">
          <Inline text={q.question} />
        </h2>
        <div className="flex flex-col gap-2" role="group" aria-label="Options">
          {q.options.map((o, i) => {
            const isRight = done && o.correct;
            const isWrong = done && i === chosen && !o.correct;
            return (
              <button
                key={i}
                disabled={done}
                onClick={() => {
                  const next = [...answers];
                  next[at] = i;
                  setAnswers(next);
                }}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 border px-3 py-2 text-left text-sm leading-[1.4]",
                  isRight ? "border-add bg-add-bg" : isWrong ? "border-del bg-del-bg" : "border-border bg-surface",
                  !done && "hover:border-accent hover:bg-accent-bg",
                  done && !isRight && !isWrong && "text-fg-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-[22px] flex-none items-center justify-center border bg-surface font-mono text-[11.5px] text-fg-2",
                    isRight ? "border-add" : isWrong ? "border-del" : "border-border",
                  )}
                >
                  {LETTERS[i]}
                </span>
                <span className="flex-1">
                  <Inline text={o.text} />
                </span>
                {isRight && <span className="text-[11.5px] font-medium text-add">Correct</span>}
                {isWrong && <span className="text-[11.5px] font-medium text-del">Your answer</span>}
              </button>
            );
          })}
        </div>
        {done && (
          <div className="flex flex-col gap-2 border border-border bg-surface-3 px-4 py-3.5">
            <span className="text-xs font-semibold">Answer: {LETTERS[correct]}</span>
            <p className="text-[13.5px] leading-[1.6]">
              <Inline text={q.explanation} />
            </p>
            <div>
              <CiteChip path={q.cite.path} start={start} end={end} />
            </div>
          </div>
        )}
        {done && (
          <div className="flex justify-end">
            <button
              onClick={() => setAt(at + 1)}
              className="flex h-7 items-center gap-1.5 border border-accent bg-accent px-3 text-[12.5px] text-surface"
            >
              {at + 1 < total ? "Next question" : "See results"}
              <Icon paths={["M3 8h9M8 4l4 4-4 4"]} size={12} />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex max-w-[640px] flex-col gap-[18px] px-7 py-[22px]">
        {header}
        {body}
        {answered === total && at < total && (
          <button onClick={() => setAt(total)} className="self-start text-[12px] text-fg-2 underline">
            See results
          </button>
        )}
      </div>
    </div>
  );
}
