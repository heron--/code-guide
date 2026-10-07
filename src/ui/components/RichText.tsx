import { parseBody } from "../../shared/guide";
import { CiteChip } from "@/code/CiteChip";
import { cn } from "@/lib/utils";

/** Inline text with `code`, **bold**, and web links. Built from React elements, never HTML, so any text is safe. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/).map((t, i) => {
        const link = t.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        if (link)
          return (
            <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-accent-fg underline">
              {link[1]}
            </a>
          );
        if (t.startsWith("`") && t.endsWith("`") && t.length > 1)
          return (
            <code key={i} className="border border-border-subtle bg-surface-3 px-0.5 font-mono text-[0.88em]">
              {t.slice(1, -1)}
            </code>
          );
        if (t.startsWith("**") && t.endsWith("**") && t.length > 3)
          return (
            <strong key={i} className="font-semibold">
              {t.slice(2, -2)}
            </strong>
          );
        return t;
      })}
    </>
  );
}

/** One line of prose: code citations (`[text](path#L1-L2)`) become file:line chips. Web pages stay links. */
function Line({ src }: { src: string }) {
  return (
    <>
      {parseBody(src)
        .flat()
        .map((part, i) =>
          part.kind === "anchor" && /^https?:\/\//.test(part.path) ? (
            <Inline
              key={i}
              text={`[${part.text}](${part.path}#L${part.range.start}${part.range.end !== part.range.start ? `-L${part.range.end}` : ""})`}
            />
          ) : part.kind === "anchor" ? (
            <CiteChip key={i} path={part.path} start={part.range.start} end={part.range.end} />
          ) : part.kind === "code" ? (
            <Inline key={i} text={`\`${part.text}\``} />
          ) : (
            <Inline key={i} text={part.text} />
          ),
        )}
    </>
  );
}

const LIST_ITEM = /^\s*([-*]|\d+\.)\s/;
const HEADING = /^#{1,6}\s+/;

type Block = { kind: "heading" | "para"; text: string } | { kind: "list"; items: string[] };

/** A paragraph's lines, grouped: each heading on its own, runs of list items, and the prose between. */
function blocks(para: string): Block[] {
  const out: Block[] = [];
  for (const line of para.split("\n").filter((l) => l.trim())) {
    const last = out.at(-1);
    if (HEADING.test(line)) out.push({ kind: "heading", text: line.replace(HEADING, "") });
    else if (LIST_ITEM.test(line)) {
      if (last?.kind === "list") last.items.push(line.replace(LIST_ITEM, ""));
      else out.push({ kind: "list", items: [line.replace(LIST_ITEM, "")] });
    } else if (last?.kind === "para") last.text += " " + line.trim();
    else if (last?.kind === "list") last.items[last.items.length - 1] += " " + line.trim();
    else out.push({ kind: "para", text: line.trim() });
  }
  return out;
}

function Block({ block: b }: { block: Block }) {
  if (b.kind === "list")
    return (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {b.items.map((item, j) => (
          <li key={j}>
            <Line src={item} />
          </li>
        ))}
      </ul>
    );
  return (
    <p className={cn(b.kind === "heading" && "pt-1 font-semibold")}>
      <Line src={b.text} />
    </p>
  );
}

/**
 * Markdown-ish text from an agent or a pull request: paragraphs, headings, lists, fenced code, inline code,
 * bold, links, and code citations. Anything else shows as written.
 */
export function RichText({ text }: { text: string }) {
  // Fenced code first: it may hold blank lines. Odd parts are code.
  const parts = text.replace(/<!--[\s\S]*?-->/g, "").split(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/m);
  return (
    <div className="flex flex-col gap-2 text-[13.5px] leading-[1.6]">
      {parts.flatMap((part, pi) =>
        pi % 2
          ? [
              <pre
                key={pi}
                className="overflow-x-auto border border-border-subtle bg-surface-3 px-2.5 py-1.5 font-mono text-[12px] leading-5"
              >
                {part.replace(/\n$/, "")}
              </pre>,
            ]
          : part
              .split(/\n\s*\n/)
              .filter((p) => p.trim())
              .flatMap((para, i) => blocks(para).map((b, j) => <Block key={`${pi}-${i}-${j}`} block={b} />)),
      )}
    </div>
  );
}
