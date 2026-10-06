import { parseBody, type Inline } from "../../shared/guide";
import { cn } from "@/lib/utils";

export type AnchorTarget = Extract<Inline, { kind: "anchor" }>;

export function Prose({
  body,
  onAnchor,
  className,
}: {
  body: string;
  /** Omit to render anchors as plain text (e.g. in previews). */
  onAnchor?: (a: AnchorTarget) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4 text-[17px] leading-[1.65]", className)}>
      {parseBody(body).map((para, pi) => (
        <p key={pi}>
          {para.map((part, i) => {
            if (part.kind === "text") return <span key={i}>{part.text}</span>;
            if (part.kind === "code")
              return (
                <code
                  key={i}
                  className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.86em]"
                >
                  {part.text}
                </code>
              );
            if (!onAnchor) return <span key={i}>{part.text}</span>;
            const lines =
              part.range.start === part.range.end
                ? `line ${part.range.start}`
                : `lines ${part.range.start}–${part.range.end}`;
            return (
              <button
                key={i}
                className="anchor-link inline text-left"
                title={`${part.path}, ${lines}`}
                onClick={() => onAnchor(part)}
              >
                {part.text}
              </button>
            );
          })}
        </p>
      ))}
    </div>
  );
}

/** First paragraph as plain text, for previews. */
export function plainFirstParagraph(body: string) {
  const [first] = parseBody(body);
  return first?.map((p) => p.text).join("") ?? "";
}
