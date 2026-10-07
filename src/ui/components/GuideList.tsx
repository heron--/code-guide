import { useEffect, useState } from "react";
import { BookOpen, CircleX, GitBranch, MessageCircleQuestion } from "lucide-react";
import type { GuideSummary } from "../../shared/guide";
import { api } from "@/lib/api";
import { href } from "@/lib/router";
import { Message } from "./GuideView";

export function GuideList() {
  const [data, setData] = useState<{ roots: string[]; guides: GuideSummary[] }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.guides().then(setData, (e) => setError(e.message));
  }, []);

  if (error) return <Message title="Couldn't list guides">{error}</Message>;
  if (!data) return <Message title="Loading…" />;

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-tight">
        <BookOpen className="size-6" /> Code Guide
      </h1>
      <p className="mt-1 truncate font-mono text-sm text-muted-foreground">{data.roots.join(", ")}</p>

      {data.guides.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border bg-card p-6 text-[15px] leading-relaxed">
          <p className="font-medium">No guides yet.</p>
          <p className="mt-2 text-muted-foreground">
            Guides live in <code className="font-mono text-foreground">.code-chapters/*.json</code> at the repository
            root. Ask your coding agent a question with the{" "}
            <code className="font-mono text-foreground">code-guide</code> skill loaded, e.g.{" "}
            <em>"/code-guide how does auth work?"</em>, then refresh this page.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-2">
          {data.guides.map((g) => (
            <li key={g.id}>
              <a
                href={href({ page: "guide", id: g.id, tab: "guide", chapter: 0 })}
                className="block rounded-xl border border-border bg-card px-5 py-4 shadow-xs transition-colors hover:border-muted-foreground/40"
              >
                <span className="flex items-center gap-2 font-medium">
                  {g.subjectType === "change" ? (
                    <GitBranch className="size-4 text-muted-foreground" />
                  ) : g.subjectType === "question" ? (
                    <MessageCircleQuestion className="size-4 text-muted-foreground" />
                  ) : (
                    <CircleX className="size-4 text-del" />
                  )}
                  {g.title}
                  <span className="ml-auto text-sm font-normal text-muted-foreground">
                    {g.errors
                      ? `${g.errors} error${g.errors === 1 ? "" : "s"}`
                      : `${g.chapters} chapter${g.chapters === 1 ? "" : "s"}`}
                  </span>
                </span>
                {g.question && <span className="mt-1 block text-[15px] text-muted-foreground">{g.question}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
