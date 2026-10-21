/** A term from a repository's glossary.md. `source` is that file's path in the repository, when known. */
export type Term = { term: string; definition: string; notConfusedWith?: string; source?: string };

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const plain = (s: string) => s.replace(/\*\*|__|`/g, "").trim();

/**
 * Terms from a glossary in this project's format: a Markdown table whose columns are term, definition and
 * (optionally) what it's not to be confused with. Anything else yields no terms rather than an error.
 */
export function parseGlossary(markdown: string): Term[] {
  const terms: Term[] = [];
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = cells(lines[i]).map((c) => c.toLowerCase());
    if (!lines[i].includes("|") || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const t = head.findIndex((c) => c === "term");
    const d = head.findIndex((c) => c === "definition");
    const n = head.findIndex((c) => c.startsWith("not to be confused"));
    if (t < 0 || d < 0) continue;
    for (let j = i + 2; j < lines.length && lines[j].includes("|"); j++) {
      const row = cells(lines[j]);
      const term = plain(row[t] ?? "");
      if (term && row[d])
        terms.push({
          term,
          definition: plain(row[d]),
          ...(n >= 0 && row[n] ? { notConfusedWith: plain(row[n]) } : {}),
        });
    }
  }
  return terms;
}

/**
 * Split text into plain runs and glossary terms (whole words, any case, plain or plural). Each term is marked
 * only the first time it appears, so prose doesn't turn into a field of underlines.
 */
export function markTerms(text: string, terms: Term[], seen: Set<string>): (string | { text: string; term: Term })[] {
  if (!terms.length) return [text];
  const byWord = new Map(terms.map((t) => [t.term.toLowerCase(), t]));
  const words = [...byWord.keys()]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(${words.join("|")})(?:e?s)?\\b`, "gi");
  const out: (string | { text: string; term: Term })[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const term = byWord.get(m[1].toLowerCase())!;
    if (seen.has(term.term)) continue;
    seen.add(term.term);
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push({ text: m[0], term });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
