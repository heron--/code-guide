import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { parseGlossary, type Term } from "../shared/glossary.js";
import type { JobKind, JobRunner, Problem } from "./jobs.js";
import type { Session } from "./session.js";

/** Where a glossary Code Guide wrote lives, for a repository that has none of its own. */
export const generatedGlossary = (repo: string) => join(repo, ".code-guide", "glossary.md");

/** The glossary to use: the repository's own glossary.md (root, any case), else the generated one, else none. */
export function glossaryPath(repo: string): string | undefined {
  const own = (() => {
    try {
      return readdirSync(repo).find((n) => n.toLowerCase() === "glossary.md");
    } catch {
      return undefined;
    }
  })();
  if (own) return join(repo, own);
  const generated = generatedGlossary(repo);
  return existsSync(generated) ? generated : undefined;
}

/** The glossary's terms. No glossary, or one that doesn't parse, means no terms. */
export async function readGlossary(repo: string): Promise<Term[]> {
  const path = glossaryPath(repo);
  return path ? parseGlossary(await readFile(path, "utf8").catch(() => "")) : [];
}

/** For a job that writes prose: where the glossary is, so it uses the repository's words. Empty without one. */
export function glossaryNote(repo: string): string {
  const path = glossaryPath(repo);
  if (!path) return "";
  return `\n\nThis repository's glossary is \`${relative(repo, path)}\`. Read it first, and use its terms, and only its terms, for the ideas it names.`;
}

/** Most terms a generated glossary holds: the words a newcomer trips on, not a dictionary. */
export const MAX_TERMS = 15;
/** Most words in one definition. */
export const DEFINITION_WORDS = 40;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const submission = z.object({
  terms: z
    .array(
      z.object({
        term: z.string().min(1).describe("The word or short phrase, as the code and docs write it"),
        definition: z
          .string()
          .min(1)
          .describe(`What it means in this repository, in at most ${DEFINITION_WORDS} words`),
        notConfusedWith: z
          .string()
          .optional()
          .describe("What a reader might mistake it for, and the difference. Omit when there's nothing to confuse."),
      }),
    )
    .min(3)
    .max(MAX_TERMS),
});

/** The glossary job: the terms a repository uses in its own sense, for a repository without a glossary. */
export const glossaryJob: JobKind = {
  kind: "glossary",
  label: "Writing the glossary",
  instructions: `You write a glossary for a codebase: the few terms a newcomer needs to read its code and docs, each defined as this repository uses it.

- Pick 3-${MAX_TERMS} terms that are specific to this project or overloaded in it: its own concepts and names, and ordinary words it uses in a narrower sense. Skip general programming vocabulary and anything the code uses in its usual meaning.
- Define each in one or two plain sentences, at most ${DEFINITION_WORDS} words, as this repository means it. Say what it is, not how it's implemented.
- When a term is easily mistaken for something else (a similar term here, or the word's usual meaning), say what it's not to be confused with, and the difference.
- Read before writing: the README and docs, then the code's main types and modules. Use the words the code and docs use.

You can read files, search, and run read-only git commands. Submit with \`submit_glossary\`; fix any errors it returns and submit again.`,
  prompt: () => "Write the glossary for the repository in the working directory.",
  submit: {
    tool: "submit_glossary",
    description: `Submit the glossary: 3-${MAX_TERMS} terms, each with a definition of at most ${DEFINITION_WORDS} words.`,
    input: submission,
    async validate(input, ctx) {
      const parsed = submission.safeParse(input);
      if (!parsed.success)
        return {
          problems: parsed.error.issues.map((i): Problem => ({
            level: "error",
            where: i.path.join(".") || "glossary",
            message: i.message,
          })),
        };
      const problems: Problem[] = [];
      const seen = new Set<string>();
      parsed.data.terms.forEach((t, i) => {
        const key = t.term.trim().toLowerCase();
        if (seen.has(key))
          problems.push({ level: "error", where: `terms.${i}`, message: `"${t.term}" is listed twice` });
        seen.add(key);
        if (/[|\n]/.test(t.term + t.definition + (t.notConfusedWith ?? "")))
          problems.push({
            level: "error",
            where: `terms.${i}`,
            message: "no | or line breaks: each term is one table row",
          });
        const n = words(t.definition);
        if (n > DEFINITION_WORDS)
          problems.push({ level: "error", where: `terms.${i}`, message: `${n} words; at most ${DEFINITION_WORDS}` });
      });
      // Saved before the job is accepted, so the glossary is there by the time anyone hears it finished.
      if (!problems.some((p) => p.level === "error")) {
        const path = generatedGlossary(ctx.repo);
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, glossaryMarkdown(parsed.data.terms));
      }
      return { problems };
    },
  },
};

/** A glossary in this project's format: one Markdown table that parseGlossary reads back. */
export function glossaryMarkdown(terms: Term[]): string {
  const rows = terms.map((t) => `| **${t.term}** | ${t.definition} | ${t.notConfusedWith ?? ""} |`);
  return `# Glossary

Written by Code Guide because this repository has no glossary.md. Add your own glossary.md at the repository root and Code Guide uses it instead.

| Term | Definition | Not to be confused with |
| --- | --- | --- |
${rows.join("\n")}
`;
}

/**
 * Writes a glossary for a repository that has none, once the session's other jobs are done, so it never holds
 * up the guide or its review. The job saves its result as the generated glossary, so it runs once per
 * repository. Returns a function that stops.
 */
export function generateGlossary(session: Session, runner: JobRunner): () => void {
  const start = () => {
    const { repo, jobs, subject } = session.state;
    if (!repo || !subject || glossaryPath(repo)) return;
    const all = Object.values(jobs);
    if (all.some((j) => j.status === "queued" || j.status === "running")) return;
    if (all.some((j) => j.kind === "glossary" && j.status !== "failed" && j.status !== "cancelled")) return;
    runner.start(glossaryJob, "glossary");
  };
  // After the event is applied, and after anything it sets off (a review queued when a guide finishes).
  return session.subscribe(
    (e) => ["session.subject", "job.finished", "job.failed", "job.cancelled"].includes(e.type) && queueMicrotask(start),
  );
}
