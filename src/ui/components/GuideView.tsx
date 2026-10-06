import { useEffect, useState } from "react";
import { ChevronLeft, GitBranch, MessageCircleQuestion } from "lucide-react";
import type { Problem, ResolvedGuide } from "../../shared/guide";
import { api } from "@/lib/api";
import { navigate, type Tab } from "@/lib/router";
import { usePersistentSet } from "@/lib/storage";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { DiffTab } from "./DiffTab";
import { GuideTab } from "./GuideTab";
import { Overview, Problems } from "./Overview";

type Loaded = ResolvedGuide | { id: string; file: string; problems: Problem[]; guide?: undefined };

export function GuideView({ id, tab, chapter }: { id: string; tab: Tab; chapter: number }) {
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setData(undefined);
    api.guide(id).then(setData, (e) => setError(e.message));
  }, [id]);

  const [reviewedChapters, toggleChapter] = usePersistentSet(`cc:${id}:chapters`);
  const [reviewedFiles, toggleFile] = usePersistentSet(`cc:${id}:files`);

  if (error) return <Message title="Couldn't load this guide">{error}</Message>;
  if (!data) return <Message title="Loading…" />;
  if (!data.guide)
    return (
      <Message title="This guide can't be opened">
        <p className="font-mono text-sm">{data.file}</p>
        <Problems problems={data.problems} />
      </Message>
    );

  const g = data.guide;
  const ch = Math.min(chapter, g.chapters.length - 1);
  const go = (t: Tab, c = ch, replace = false) => navigate({ page: "guide", id, tab: t, chapter: c }, replace);
  const isChange = g.subject.type === "change";

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-8 pt-6">
        <a href="#/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Guides
        </a>
        <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-tight">{g.title}</h1>
        <p className="mt-1.5 flex min-w-0 items-center gap-2 text-[15px] text-muted-foreground">
          {g.subject.type === "change" ? (
            <>
              <GitBranch className="size-4 shrink-0" />
              <span className="truncate font-mono text-sm">
                {g.subject.base} ← {g.subject.head ?? "working tree"}
              </span>
            </>
          ) : (
            <>
              <MessageCircleQuestion className="size-4 shrink-0" />
              <span className="truncate">{g.question}</span>
              {g.subject.ref && <span className="shrink-0 font-mono text-sm">@ {g.subject.ref.slice(0, 12)}</span>}
            </>
          )}
        </p>
        <Tabs value={tab} onValueChange={(v) => go(v as Tab)} className="mt-5">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="guide">Guide</TabsTrigger>
            {isChange && <TabsTrigger value="diff">Diff</TabsTrigger>}
          </TabsList>
        </Tabs>
      </header>

      {tab === "overview" && <Overview data={data} reviewed={reviewedChapters} onOpenChapter={(n) => go("guide", n)} />}
      {tab === "guide" && (
        <GuideTab
          key={ch}
          data={data}
          chapter={ch}
          setChapter={(n) => go("guide", n, true)}
          reviewedChapters={reviewedChapters}
          setChapterReviewed={(n, v) => toggleChapter(String(n), v)}
          reviewedFiles={reviewedFiles}
          setFileReviewed={toggleFile}
        />
      )}
      {tab === "diff" && isChange && <DiffTab data={data} reviewedFiles={reviewedFiles} setFileReviewed={toggleFile} />}
    </div>
  );
}

export function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-8 py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-3 text-muted-foreground">{children}</div>
    </div>
  );
}
