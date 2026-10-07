import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedFile } from "../../shared/guide";
import { FileCard } from "@/code/FileCard";
import { indexRange, initialVisible } from "@/code/excerpt";
import type { LinesTarget } from "./actions";
import { Icon, icons } from "./Icon";

/** Cited lines in a file no panel is showing: a plain view over the workspace, closed with × or Esc. */
export function FileView({ target, file, onClose }: { target: LinesTarget; file: ResolvedFile; onClose: () => void }) {
  const range = { start: target.start, end: Math.max(target.start, target.end) };
  const initial = useMemo(() => initialVisible(file, [range]), [file, range.start, range.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const [visible, setVisible] = useState(initial);
  const marked = indexRange(file, range);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => setVisible(initial), [initial]);
  useEffect(() => {
    const row = marked && scroller.current?.querySelector(`[data-idx="${marked[0]}"]`);
    row?.scrollIntoView({ block: "center" });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute inset-x-[10%] top-12 bottom-20 z-30 flex flex-col border border-rule bg-surface shadow-active">
      <header className="flex h-7 flex-none items-center gap-2 border-b border-rule bg-surface-3 pr-[5px] pl-[9px]">
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">
          {target.path}:{range.start === range.end ? range.start : `${range.start}–${range.end}`}
        </span>
        <button
          aria-label="Close"
          onClick={onClose}
          className="flex size-[18px] items-center justify-center border border-border bg-surface text-fg-2 hover:text-fg"
        >
          <Icon paths={icons.close} size={10} />
        </button>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-surface-2 p-3">
        <FileCard
          id="file-view"
          file={file}
          visible={visible}
          marked={marked}
          onReveal={(from, to) => setVisible((v) => v.map((s, i) => s || (i >= from && i <= to)))}
        />
      </div>
    </div>
  );
}
