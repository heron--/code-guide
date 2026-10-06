import { AlertTriangle, CheckCircle2, CircleX } from "lucide-react";
import type { Problem, ResolvedGuide } from "../../shared/guide";
import { plainFirstParagraph } from "./Prose";
import { cn } from "@/lib/utils";

export function Overview({
  data,
  reviewed,
  onOpenChapter,
}: {
  data: ResolvedGuide;
  reviewed: Set<string>;
  onOpenChapter: (n: number) => void;
}) {
  const { guide } = data;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 pb-24 pt-8">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Question</p>
        <p className="mt-2 text-xl leading-snug">{guide.question}</p>

        <p className="mt-8 text-sm font-medium uppercase tracking-wide text-muted-foreground">Answer</p>
        <p className="mt-2 text-[17px] leading-relaxed">{guide.answer}</p>

        <p className="mt-10 text-sm font-medium uppercase tracking-wide text-muted-foreground">Chapters</p>
        <ol className="mt-3 space-y-2">
          {guide.chapters.map((c, i) => (
            <li key={i}>
              <button
                onClick={() => onOpenChapter(i)}
                className="flex w-full gap-4 rounded-xl border border-border bg-card px-5 py-4 text-left shadow-xs transition-colors hover:border-muted-foreground/40"
              >
                <span className="pt-0.5 font-mono text-sm tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium">
                    {c.title}
                    {reviewed.has(String(i)) && <CheckCircle2 className="size-4 text-add" aria-label="Reviewed" />}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-[15px] text-muted-foreground">
                    {plainFirstParagraph(c.body)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>

        {data.problems.length > 0 && <Problems problems={data.problems} />}
      </div>
    </div>
  );
}

export function Problems({ problems }: { problems: Problem[] }) {
  const errors = problems.filter((p) => p.level === "error").length;
  return (
    <div className="mt-10">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Spec check · {errors} error{errors === 1 ? "" : "s"}, {problems.length - errors} warning
        {problems.length - errors === 1 ? "" : "s"}
      </p>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card text-sm">
        {problems.map((p, i) => (
          <li key={i} className="flex gap-3 px-4 py-2.5">
            {p.level === "error" ? (
              <CircleX className="mt-0.5 size-4 shrink-0 text-del" />
            ) : (
              <AlertTriangle className={cn("mt-0.5 size-4 shrink-0 text-amber-500")} />
            )}
            <span>
              <span className="font-mono text-[13px] text-muted-foreground">{p.where}</span>
              <br />
              {p.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
