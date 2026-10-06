import { z } from "zod";

export const SPEC_VERSION = "code-chapters/v1";

const lineRange = z.string().regex(/^\d+(-\d+)?$/, 'line ranges look like "42" or "42-60"');

export const excerptSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), 'paths are repository-relative, with no ".."'),
  lines: z.array(lineRange).optional(),
});

export const chapterSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  excerpts: z.array(excerptSchema).min(1, "a chapter needs at least one excerpt"),
});

export const subjectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("question"), ref: z.string().min(1).optional() }),
  z.object({
    type: z.literal("change"),
    base: z.string().min(1),
    head: z.string().min(1).optional(),
  }),
]);

export const guideSchema = z.object({
  spec: z.literal(SPEC_VERSION),
  title: z.string().min(1),
  question: z.string().min(1),
  subject: subjectSchema,
  answer: z.string().min(1),
  chapters: z.array(chapterSchema).min(1, "a guide needs at least one chapter"),
});

export type Guide = z.infer<typeof guideSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Excerpt = z.infer<typeof excerptSchema>;
export type Subject = z.infer<typeof subjectSchema>;

/** An inclusive, 1-based line range. */
export type Range = { start: number; end: number };

export function parseRange(s: string): Range {
  const [a, b] = s.split("-").map(Number);
  return { start: a, end: b ?? a };
}

/** Prose is split into paragraphs of text, inline code, and anchors. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "anchor"; text: string; path: string; range: Range };

const INLINE_RE = /`([^`]+)`|\[([^\]]+)\]\(([^)#]+)#L(\d+)(?:-L?(\d+))?\)/g;

export function parseBody(body: string): Inline[][] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const out: Inline[] = [];
      let last = 0;
      for (const m of p.matchAll(INLINE_RE)) {
        if (m.index! > last) out.push({ kind: "text", text: p.slice(last, m.index) });
        if (m[1] !== undefined) out.push({ kind: "code", text: m[1] });
        else {
          const start = Number(m[4]);
          out.push({
            kind: "anchor",
            text: m[2],
            path: m[3],
            range: { start, end: m[5] ? Number(m[5]) : start },
          });
        }
        last = m.index! + m[0].length;
      }
      if (last < p.length) out.push({ kind: "text", text: p.slice(last) });
      return out;
    });
}

/** Markdown links in the body that aren't well-formed anchors. */
export function malformedLinks(body: string): string[] {
  const stripped = body.replace(INLINE_RE, "");
  return [...stripped.matchAll(/\[[^\]]*\]\([^)]*\)/g)].map((m) => m[0]);
}

export function wordCount(s: string): number {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .split(/\s+/)
    .filter(Boolean).length;
}

// ---- Resolved shapes, served to the viewer ----

/** [text, light color, dark color] */
export type Token = [string, string?, string?];

export type Line = {
  /** " " context, "+" added, "-" removed */
  k: " " | "+" | "-";
  /** old-side line number */
  o?: number;
  /** new-side line number */
  n?: number;
  t: Token[];
};

export type FileStatus = "added" | "deleted" | "modified" | "unchanged";

export type ResolvedFile = {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  lines: Line[];
};

export type Problem = {
  level: "error" | "warning";
  where: string;
  message: string;
};

export type GuideSummary = {
  id: string;
  file: string;
  title: string;
  question: string;
  subjectType: Subject["type"] | "invalid";
  chapters: number;
  errors: number;
};

export type ResolvedGuide = {
  id: string;
  file: string;
  repo: string;
  guide: Guide;
  /** For a change: the resolved commits being compared. */
  refs?: { base: string; head: string };
  files: Record<string, ResolvedFile>;
  /** For a change: every changed file, in diff order. */
  changed?: { path: string; additions: number; deletions: number; status: FileStatus }[];
  problems: Problem[];
};
