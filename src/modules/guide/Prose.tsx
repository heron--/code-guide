import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { markTerms, type Term } from "../../shared/glossary";
import { parseBody, type Inline } from "../../shared/guide";
import { useSession } from "@/lib/session";

export type AnchorTarget = Extract<Inline, { kind: "anchor" }>;

let glossary: { written: number; terms: Promise<Term[]> } | undefined;
/** The repository's glossary terms: fetched once, and again when the session writes one. */
function useGlossary(): Term[] {
  const { state } = useSession();
  const written = state
    ? Object.values(state.jobs).filter((j) => j.kind === "glossary" && j.status === "finished").length
    : 0;
  const [terms, setTerms] = useState<Term[]>([]);
  useEffect(() => {
    if (glossary?.written !== written)
      glossary = {
        written,
        terms: fetch("/api/glossary").then(
          (r) => (r.ok ? r.json() : []),
          () => [],
        ),
      };
    let current = true;
    glossary.terms.then((t) => current && setTerms(t));
    return () => {
      current = false;
    };
  }, [written]);
  return terms;
}

const TOOLTIP_WIDTH = 256;
const MARGIN = 8;

/**
 * A glossary term: a quiet dotted underline (anchors are solid and blue), its definition on hover or focus.
 * The definition renders in a portal with fixed positioning, so panel overflow and neighbouring panels can't cover it.
 */
function GlossaryTerm({ text, term }: { text: string; term: Term }) {
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  // Hover and focus each keep the definition open; it closes when neither holds.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - TOOLTIP_WIDTH - MARGIN));
    // Open upward when the term sits in the bottom third of the window.
    const above = r.bottom > window.innerHeight * (2 / 3);
    setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
  };
  const open = pos && (hovered || focused);
  // A fixed tooltip would drift from its term when any panel scrolls, so close it instead.
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);
  return (
    <span
      tabIndex={0}
      onMouseEnter={(e) => {
        setHovered(true);
        place(e.currentTarget);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => {
        setFocused(true);
        place(e.currentTarget);
      }}
      onBlur={() => setFocused(false)}
      className="cursor-help underline decoration-fg-3 decoration-dotted underline-offset-4 outline-none focus-visible:bg-surface-3"
    >
      {text}
      {open &&
        createPortal(
          <span
            role="tooltip"
            style={{
              left: pos.left,
              top: pos.top,
              width: TOOLTIP_WIDTH,
              transform: pos.above ? "translateY(-100%)" : undefined,
            }}
            className="pointer-events-none fixed z-50 border border-rule bg-surface p-2.5 text-[12.5px] leading-normal font-normal text-fg shadow-active"
          >
            <span className="block font-semibold">{term.term}</span>
            <span className="mt-1 block">{term.definition}</span>
            {term.notConfusedWith && (
              <span className="mt-1.5 block text-fg-2">
                <span className="font-medium">Not to be confused with:</span> {term.notConfusedWith}
              </span>
            )}
          </span>,
          document.body,
        )}
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
