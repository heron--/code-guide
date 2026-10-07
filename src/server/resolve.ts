import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  guideSchema,
  malformedLinks,
  parseBody,
  parseRange,
  wordCount,
  type Guide,
  type Problem,
  type Range,
  type ResolvedFile,
  type ResolvedGuide,
} from "../shared/guide.js";
import {
  changedFiles,
  diffStatus,
  fileAt,
  fullFileDiff,
  mergeBase,
  repoRoot,
  revParse,
  splitLines,
  type RawLine,
} from "./git.js";
import { highlight } from "./highlight.js";

export const LIMITS = {
  guideTitleWords: 8,
  answerWords: 50,
  chapters: 7,
  chapterTitleWords: 6,
  bodyWords: 70,
  paragraphs: 3,
  excerpts: 4,
  shownLines: 80,
};

export function guideId(file: string) {
  return basename(file).replace(/\.json$/, "");
}

/** Last line number a range may reference: new side, or old side for a deleted file. */
export function lastLine(file: ResolvedFile): number {
  let max = 0;
  for (const l of file.lines) max = Math.max(max, (file.status === "deleted" ? l.o : l.n) ?? 0);
  return max;
}

type Load = { guide?: Guide; problems: Problem[] };

/** Check a parsed guide against the schema. */
export function parseGuide(json: unknown): Load {
  const parsed = guideSchema.safeParse(json);
  if (!parsed.success) {
    return {
      problems: parsed.error.issues.map((i) => ({
        level: "error" as const,
        where: i.path.join(".") || "guide",
        message: i.message,
      })),
    };
  }
  return { guide: parsed.data, problems: [] };
}

async function load(file: string): Promise<Load> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    return { problems: [{ level: "error", where: "file", message: `not valid JSON: ${(e as Error).message}` }] };
  }
  return parseGuide(json);
}

function toResolved(path: string, raw: RawLine[], status: ResolvedFile["status"]): Omit<ResolvedFile, "lines"> {
  return {
    path,
    status,
    additions: raw.filter((l) => l.k === "+").length,
    deletions: raw.filter((l) => l.k === "-").length,
  };
}

export type Resolution = { resolved?: ResolvedGuide; problems: Problem[] };

export async function resolveGuide(file: string): Promise<Resolution> {
  const { guide, problems } = await load(file);
  if (!guide) return { problems };
  const repo = await repoRoot(dirname(file));
  if (!repo)
    return { problems: [{ level: "error", where: "file", message: "the guide is not inside a git repository" }] };
  return checkGuide(guide, repo, { id: guideId(file), file });
}

/**
 * Resolve a guide against a repository and check it against the spec: every error (it won't render) and
 * warning (it breaks the quality bar). The guide can come from a file or from a job's submission.
 */
export async function checkGuide(guide: Guide, repo: string, at: { id: string; file: string }): Promise<Resolution> {
  const problems: Problem[] = [];
  const err = (where: string, message: string) => problems.push({ level: "error", where, message });
  const warn = (where: string, message: string) => problems.push({ level: "warning", where, message });

  // ---- Subject ----
  const subject = guide.subject;
  let readRef: string | undefined; // question: commit to read from (undefined = working tree)
  let base: string | undefined; // change: merge-base
  let head: string | undefined; // change: head commit (undefined = working tree)
  if (subject.type === "question") {
    if (subject.ref) {
      readRef = await revParse(repo, subject.ref);
      if (!readRef) err("subject.ref", `unknown ref "${subject.ref}"`);
    }
  } else {
    const b = await revParse(repo, subject.base);
    if (!b) err("subject.base", `unknown ref "${subject.base}"`);
    if (subject.head) {
      head = await revParse(repo, subject.head);
      if (!head) err("subject.head", `unknown ref "${subject.head}"`);
    }
    if (b && (head || !subject.head)) base = await mergeBase(repo, b, head ?? "HEAD");
  }
  if (problems.some((p) => p.level === "error")) return { problems };

  // ---- Files ----
  const files: Record<string, ResolvedFile> = {};
  const resolveFile = async (path: string): Promise<ResolvedFile | undefined> => {
    let raw: RawLine[];
    let meta: Omit<ResolvedFile, "lines">;
    const diff = base ? await fullFileDiff(repo, base, head, path) : undefined;
    if (diff) {
      raw = diff;
      meta = toResolved(path, raw, diffStatus(diff));
    } else {
      const text = await fileAt(repo, base ? head : readRef, path);
      if (text === undefined) return undefined;
      raw = splitLines(text).map((t, i) => ({ k: " ", o: i + 1, n: i + 1, text: t }));
      meta = toResolved(path, raw, "unchanged");
    }
    const tokens = await highlight(
      path,
      raw.map((l) => l.text),
    );
    return { ...meta, lines: raw.map(({ text: _, ...l }, i) => ({ ...l, t: tokens[i] })) };
  };

  const paths = [...new Set(guide.chapters.flatMap((c) => c.excerpts.map((e) => e.path)))];
  await Promise.all(
    paths.map(async (p) => {
      const f = await resolveFile(p);
      if (f) files[p] = f;
    }),
  );

  // ---- Guide-level quality ----
  if (wordCount(guide.title) > LIMITS.guideTitleWords) warn("title", `over ${LIMITS.guideTitleWords} words`);
  if (wordCount(guide.answer) > LIMITS.answerWords)
    warn("answer", `${wordCount(guide.answer)} words; keep it under ${LIMITS.answerWords}`);
  if (guide.chapters.length > LIMITS.chapters)
    warn("chapters", `${guide.chapters.length} chapters; the maximum is ${LIMITS.chapters}`);

  // ---- Chapters ----
  guide.chapters.forEach((c, ci) => {
    const where = `chapters[${ci}] "${c.title}"`;
    const titleWords = wordCount(c.title);
    if (titleWords > LIMITS.chapterTitleWords)
      warn(where, `title is ${titleWords} words; keep it to ${LIMITS.chapterTitleWords}`);
    if (/\.\s*$/.test(c.title)) warn(where, "title ends with a period");

    const paragraphs = parseBody(c.body);
    const words = wordCount(c.body);
    if (words > LIMITS.bodyWords) warn(where, `body is ${words} words; keep it under ${LIMITS.bodyWords}`);
    if (paragraphs.length > LIMITS.paragraphs)
      warn(where, `body has ${paragraphs.length} paragraphs; keep it to ${LIMITS.paragraphs}`);
    for (const link of malformedLinks(c.body))
      err(where, `${link} is not an anchor; anchors look like [text](path/to/file#L10-L20)`);

    if (c.excerpts.length > LIMITS.excerpts)
      warn(where, `${c.excerpts.length} excerpts; keep it to ${LIMITS.excerpts}`);

    const ranges = new Map<string, Range[] | undefined>();
    let shown = 0;
    c.excerpts.forEach((e, ei) => {
      const ew = `${where} excerpts[${ei}] ${e.path}`;
      if (ranges.has(e.path)) err(ew, "the same file appears twice in this chapter; merge the line ranges");
      const f = files[e.path];
      if (!f) {
        const at =
          subject.type === "question" ? (subject.ref ?? "the working tree") : (subject.head ?? "the working tree");
        err(ew, `file not found at ${at}`);
        ranges.set(e.path, undefined);
        return;
      }
      if (subject.type === "question" && !e.lines) err(ew, `"lines" is required for a question guide`);
      const rs = e.lines?.map(parseRange);
      ranges.set(e.path, rs);
      const last = lastLine(f);
      rs?.forEach((r, ri) => {
        if (r.start < 1 || r.end < r.start) err(ew, `range "${e.lines![ri]}" is not ascending`);
        if (r.end > last) err(ew, `range "${e.lines![ri]}" is past the end of the file (${last} lines)`);
        if (ri > 0 && r.start <= rs[ri - 1].end)
          err(ew, `range "${e.lines![ri]}" overlaps or precedes the one before it`);
      });
      shown += rs ? rs.reduce((n, r) => n + r.end - r.start + 1, 0) : f.additions + f.deletions;
    });
    if (shown > LIMITS.shownLines)
      warn(
        where,
        `shows ${shown} lines of code; keep it under ${LIMITS.shownLines} (narrow the ranges or split the chapter)`,
      );

    const anchors = paragraphs.flat().filter((i) => i.kind === "anchor");
    if (anchors.length === 0) warn(where, "no anchors; link the phrase that names the code to its lines");
    for (const a of anchors) {
      const aw = `${where} anchor "${a.text}"`;
      const text = a.text.trim().toLowerCase();
      if (
        ["here", "this", "link", "see", "this file", "this line", "these lines"].includes(text) ||
        basename(a.path).toLowerCase() === text
      )
        warn(aw, 'link text should be a noun phrase from the sentence, not "here" or a file name');
      if (!ranges.has(a.path)) {
        err(aw, `points at ${a.path}, which isn't one of this chapter's excerpts`);
        continue;
      }
      const f = files[a.path];
      if (!f) continue;
      if (a.range.end < a.range.start) err(aw, "line range is not ascending");
      else if (a.range.end > lastLine(f))
        err(aw, `line ${a.range.end} is past the end of the file (${lastLine(f)} lines)`);
      else {
        const rs = ranges.get(a.path);
        if (rs && !rs.some((r) => a.range.start >= r.start && a.range.end <= r.end))
          warn(aw, `lines ${a.range.start}-${a.range.end} fall outside the excerpt's "lines"`);
      }
    }
  });

  const resolved: ResolvedGuide = {
    ...at,
    repo,
    guide,
    files,
    problems,
  };
  if (base) {
    resolved.refs = { base, head: head ?? "working tree" };
    resolved.changed = await changedFiles(repo, base, head);
  }
  return { resolved, problems };
}

/** Resolve a single changed file for the full diff view. */
export async function resolveChangedFile(
  repo: string,
  base: string,
  head: string | undefined,
  path: string,
): Promise<ResolvedFile | undefined> {
  const diff = await fullFileDiff(repo, base, head, path);
  if (!diff) return undefined;
  const tokens = await highlight(
    path,
    diff.map((l) => l.text),
  );
  return {
    ...toResolved(path, diff, diffStatus(diff)),
    lines: diff.map(({ text: _, ...l }, i) => ({ ...l, t: tokens[i] })),
  };
}

/**
 * The commits a change compares: the merge-base of base and head, and head (undefined for the working tree).
 * Undefined if either ref doesn't resolve.
 */
export async function changeRefs(
  repo: string,
  change: { base: string; head?: string },
): Promise<{ base: string; head?: string } | undefined> {
  const b = await revParse(repo, change.base);
  const h = change.head ? await revParse(repo, change.head) : undefined;
  if (!b || (change.head && !h)) return undefined;
  return { base: await mergeBase(repo, b, h ?? "HEAD"), head: h };
}

/**
 * Any file as the session's subject shows it: its diff if the change touches it, else the file at the change's
 * head, or in the working tree. For citations, which can point anywhere.
 */
export async function resolveSubjectFile(
  repo: string,
  subject: { type: string; base?: string; head?: string },
  path: string,
): Promise<ResolvedFile | undefined> {
  if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) return undefined;
  let ref: string | undefined;
  if (subject.type === "change" && subject.base) {
    const refs = await changeRefs(repo, { base: subject.base, head: subject.head });
    if (!refs) return undefined;
    const changed = await resolveChangedFile(repo, refs.base, refs.head, path);
    if (changed) return changed;
    ref = refs.head;
  }
  const text = await fileAt(repo, ref, path);
  if (text === undefined) return undefined;
  const raw = splitLines(text).map((t, i): RawLine => ({ k: " ", o: i + 1, n: i + 1, text: t }));
  const tokens = await highlight(
    path,
    raw.map((l) => l.text),
  );
  return {
    ...toResolved(path, raw, "unchanged"),
    lines: raw.map(({ text: _, ...l }, i) => ({ ...l, t: tokens[i] })),
  };
}
