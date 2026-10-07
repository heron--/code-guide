import { parseBody, type Inline } from "../../shared/guide";

export type AnchorTarget = Extract<Inline, { kind: "anchor" }>;

/** A chapter's prose: paragraphs with inline code and anchors that jump to their lines. */
export function Prose({ body, onAnchor }: { body: string; onAnchor: (a: AnchorTarget) => void }) {
  return (
    <div className="flex flex-col gap-3 text-[14.5px] leading-[1.62]">
      {parseBody(body).map((para, pi) => (
        <p key={pi}>
          {para.map((part, i) => {
            if (part.kind === "text") return <span key={i}>{part.text}</span>;
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
