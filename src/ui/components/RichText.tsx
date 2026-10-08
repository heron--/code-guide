import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CiteChip } from "@/code/CiteChip";

/** A link into the repository with lines, e.g. `src/a.ts#L3-L9`. Anything with a scheme is a web link. */
const CITATION = /^([^:#?]+)#L(\d+)(?:-L?(\d+))?$/;

function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

type Node = { type: string; value?: string; children?: Node[] };

/**
 * Raw HTML shows as the text it is, so a pull request body can't inject markup. Comments are dropped, as
 * GitHub hides them (templates are full of them).
 */
function htmlAsText() {
  const walk = (node: Node) => {
    if (!node.children) return;
    node.children = node.children.flatMap((c) => {
      if (c.type !== "html") return [c];
      if (/^\s*<!--[\s\S]*?-->\s*$/.test(c.value ?? "")) return [];
      return [{ type: "text", value: c.value }];
    });
    node.children.forEach(walk);
  };
  return walk;
}

const components: Components = {
  a: ({ href = "", children }) => {
    // Destinations arrive URL-encoded, so a path with spaces (written `<my dir/a.ts#L2>`) reads as %20.
    const cite = safeDecode(href).match(CITATION);
    if (cite) {
      const start = Number(cite[2]);
      return <CiteChip path={cite[1]} start={start} end={cite[3] ? Number(cite[3]) : start} />;
    }
    // Only web links go anywhere: a bare repository path has nowhere to open.
    if (!/^(https?|mailto):/i.test(href)) return <>{children}</>;
    return (
      <a href={href} target="_blank" rel="noreferrer" className="text-accent-fg underline">
        {children}
      </a>
    );
  },
  // Images become links, so reading a pull request doesn't load third-party pictures.
  img: ({ src, alt }) =>
    typeof src === "string" && /^https?:/i.test(src) ? (
      <a href={src} target="_blank" rel="noreferrer" className="text-accent-fg underline">
        {alt || "image"}
      </a>
    ) : (
      <>{alt}</>
    ),
  h1: ({ children }) => <p className="pt-1 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="pt-1 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="pt-1 font-semibold">{children}</p>,
  h4: ({ children }) => <p className="pt-1 font-semibold">{children}</p>,
  h5: ({ children }) => <p className="pt-1 font-semibold">{children}</p>,
  h6: ({ children }) => <p className="pt-1 font-semibold">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children, className }) => (
    <ul className={className === "contains-task-list" ? "flex flex-col gap-1" : "flex list-disc flex-col gap-1 pl-5"}>
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className="flex list-decimal flex-col gap-1 pl-5">
      {children}
    </ol>
  ),
  li: ({ children, className }) => (
    <li className={className === "task-list-item" ? "list-none" : "[&>ol]:mt-1 [&>ul]:mt-1"}>{children}</li>
  ),
  code: ({ children }) => (
    <code className="border border-border-subtle bg-surface-3 px-0.5 font-mono text-[0.88em]">{children}</code>
  ),
  // A code block's <code> drops the inline look above.
  pre: ({ children }) => (
    <pre className="overflow-x-auto border border-border-subtle bg-surface-3 px-2.5 py-1.5 font-mono text-[12px] leading-5 [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="flex flex-col gap-2 border-l-2 border-border pl-3 text-fg-2">{children}</blockquote>
  ),
  hr: () => <hr className="border-border-subtle" />,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border border-border-subtle bg-surface-3 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border border-border-subtle px-2 py-1">
      {children}
    </td>
  ),
};

/**
 * Markdown from an agent or a pull request, rendered as React elements (never as HTML). Repository links with
 * lines (`[text](path#L1-L2)`) become file:line chips; web links stay links.
 */
export function RichText({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-[13.5px] leading-[1.6]">
      <Markdown remarkPlugins={[remarkGfm, htmlAsText]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
