import { useActions, type LinesTarget } from "@/workspace/actions";

/** A file:line chip. Clicking it shows those lines wherever the workspace can: Guide, Diff, or a file view. */
export function CiteChip({ path, start, end, label }: LinesTarget & { label?: string }) {
  const { showLines } = useActions();
  const name = path.split("/").pop();
  const lines = end > start ? `${start}–${end}` : `${start}`;
  return (
    <button
      onClick={() => showLines({ path, start, end })}
      title={`${path}, line${end > start ? "s" : ""} ${lines}`}
      className="mx-px inline-flex h-[18px] items-center border border-accent-underline bg-accent-bg px-[5px] align-[1px] font-mono text-[11px] whitespace-nowrap text-accent-fg hover:border-accent"
    >
      {label ?? `${name}:${lines}`}
    </button>
  );
}
