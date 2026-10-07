import { useEffect, useState } from "react";
import { markTerms, type Term } from "../../shared/glossary";
import { parseBody, type Inline } from "../../shared/guide";

export type AnchorTarget = Extract<Inline, { kind: "anchor" }>;

let glossary: Promise<Term[]> | undefined;
/** The repository's glossary terms, fetched once. */
function useGlossary(): Term[] {
  const [terms, setTerms] = useState<Term[]>([]);
  useEffect(() => {
    glossary ??= fetch("/api/glossary").then(
      (r) => (r.ok ? r.json() : []),
      () => [],
    );
    let current = true;
    glossary.then((t) => current && setTerms(t));
    return () => {
      current = false;
    };
  }, []);
  return terms;
}

/** A glossary term: a quiet dotted underline (anchors are solid and blue), its definition on hover or focus. */
function GlossaryTerm({ text, term }: { text: string; term: Term }) {
  return (
    <span
      tabIndex={0}
      className="group/term relative cursor-help underline decoration-fg-3 decoration-dotted underline-offset-4 outline-none focus-visible:bg-surface-3"
    >
      {text}
      <span
        role="tooltip"
        className="invisible absolute top-full left-0 z-30 mt-1.5 w-64 border border-rule bg-surface p-2.5 text-[12.5px] leading-normal font-normal text-fg shadow-active group-hover/term:visible group-focus/term:visible"
      >
        <span className="block font-semibold">{term.term}</span>
        <span className="mt-1 block">{term.definition}</span>
        {term.notConfusedWith && (
          <span className="mt-1.5 block text-fg-2">
            <span className="font-medium">Not to be confused with:</span> {term.notConfusedWith}
          </span>
        )}
      </span>
    </span>
  );
}

/** A chapter's prose: paragraphs with inline code, anchors that jump to their lines, and glossary terms. */
export function Prose({ body, onAnchor }: { body: string; onAnchor: (a: AnchorTarget) => void }) {
  const terms = useGlossary();
  const seen = new Set<string>();
  return (
    <div className="flex flex-col gap-3 text-[14.5px] leading-[1.62]">
      {parseBody(body).map((para, pi) => (
        <p key={pi}>
          {para.map((part, i) => {
            if (part.kind === "text")
              return (
                <span key={i}>
                  {markTerms(part.text, terms, seen).map((t, j) =>
                    typeof t === "string" ? t : <GlossaryTerm key={j} text={t.text} term={t.term} />,
                  )}
                </span>
              );
            if (part.kind === "code")
              return (
                <code key={i} className="border border-border-subtle bg-surface-3 px-0.5 font-mono text-[0.86em]">
                  {part.text}
                </code>
              );
            const lines =
              part.range.start === part.range.end
                ? `line ${part.range.start}`
                : `lines ${part.range.start}–${part.range.end}`;
            return (
              <button
                key={i}
                className="anchor-link inline text-left text-accent-fg"
                title={`${part.path}, ${lines}`}
                onClick={() => onAnchor(part)}
              >
                {part.text.split("`").map((t, j) =>
                  j % 2 ? (
                    <code key={j} className="font-mono text-[0.86em]">
                      {t}
                    </code>
                  ) : (
                    t
                  ),
                )}
              </button>
            );
          })}
        </p>
      ))}
    </div>
  );
}
