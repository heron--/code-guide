import { useEffect, useState, type RefObject } from "react";
import type { ResolvedFile } from "../../shared/guide";
import type { ChatContext } from "../../shared/protocol";
import { useActions } from "./actions";
import { Icon } from "./Icon";
import { isMac, Kbd } from "./Kbd";

type Selection = { contexts: ChatContext[]; label: string; x: number; y: number };

/**
 * Selecting code in a panel (or prose, if the panel says what it's from) offers to ask about it in Chat. Code is
 * found by the file card's `data-path` and each row's `data-idx`; `file` gives the lines behind them.
 */
export function useAskSelection(
  root: RefObject<HTMLElement | null>,
  opts: {
    file: (path: string) => ResolvedFile | undefined;
    /** `block` is the selection's `[data-prose]` element, for a panel that shows more than one. */
    prose?: (text: string, block: HTMLElement) => ChatContext | undefined;
  },
) {
  const { ask } = useActions();
  const [selection, setSelection] = useState<Selection>();
  // A selection cleared, or made in another panel, takes the offer away.
  useEffect(() => {
    if (!selection) return;
    const changed = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !root.current?.contains(sel.anchorNode)) setSelection(undefined);
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [selection, root]);

  const onSelect = () => {
    const sel = window.getSelection();
    const box = root.current?.getBoundingClientRect();
    if (!sel || sel.isCollapsed || !box || !root.current?.contains(sel.anchorNode)) return setSelection(undefined);
    const el = (n: Node | null) => (n instanceof Element ? n : n?.parentElement) ?? null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const at = { x: Math.max(8, rect.left - box.left), y: rect.bottom - box.top + 6 };
    const card = el(sel.anchorNode)?.closest("section[data-path]");
    // Row indexes restart in every file card: a selection across two can't be one range.
    if (card && card !== el(sel.focusNode)?.closest("section[data-path]")) return setSelection(undefined);
    if (card) {
      const path = card.getAttribute("data-path")!;
      const file = opts.file(path);
      if (!file) return setSelection(undefined);
      const idx = [sel.anchorNode, sel.focusNode]
        .map((n) => el(n)?.closest("[data-idx]")?.getAttribute("data-idx"))
        .filter((i): i is string => i != null)
        .map(Number);
      if (!idx.length) return setSelection(undefined);
      // Lines on the new side, by their new numbers; removed lines (or a deleted file's) by the base side's.
      // A selection with both, like a whole replaced hunk, attaches one range from each side.
      const rows = file.lines.slice(Math.min(...idx), Math.max(...idx) + 1);
      const deleted = file.status === "deleted";
      const range = (nums: (number | undefined)[]) => {
        const n = nums.filter((x): x is number => x != null);
        return n.length ? { start: Math.min(...n), end: Math.max(...n) } : undefined;
      };
      const now = deleted ? undefined : range(rows.map((l) => l.n));
      const before = range(rows.filter((l) => deleted || l.k === "-").map((l) => l.o));
      const contexts: ChatContext[] = [
        ...(now ? [{ kind: "code" as const, path, ...now }] : []),
        ...(before ? [{ kind: "code" as const, path, ...before, side: "old" as const }] : []),
      ];
      if (!contexts.length) return setSelection(undefined);
      const { start, end } = now ?? before!;
      const lines = start === end ? `line ${start}` : `lines ${start}–${end}`;
      return setSelection({
        contexts,
        label: now && before ? `Ask about ${lines} and the removed lines` : `Ask about ${lines}`,
        ...at,
      });
    }
    const text = sel.toString().trim();
    const block = el(sel.anchorNode)?.closest<HTMLElement>("[data-prose]");
    const context = text && block ? opts.prose?.(text, block) : undefined;
    setSelection(context && { contexts: [context], label: "Ask about this", ...at });
  };

  const askSelection = () => {
    if (!selection) return;
    for (const c of selection.contexts) ask(c);
    setSelection(undefined);
    window.getSelection()?.removeAllRanges();
  };

  /** ⌘L / Ctrl+L asks about the selection. Returns whether it handled the key. */
  const onKey = (e: React.KeyboardEvent) => {
    if (!selection || e.key !== "l" || !(isMac ? e.metaKey : e.ctrlKey)) return false;
    askSelection();
    return true;
  };

  const chip = selection && (
    <div
      className="absolute z-20 flex h-[30px] items-center gap-2 border border-rule bg-surface pr-1.5 pl-1 shadow-active"
      style={{ left: selection.x, top: selection.y }}
    >
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={askSelection}
        className="flex h-[22px] items-center gap-1.5 bg-accent px-2 text-xs font-medium text-surface"
      >
        <Icon paths={["M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"]} size={12} />
        {selection.label}
      </button>
      <Kbd>{isMac ? "⌘L" : "Ctrl+L"}</Kbd>
    </div>
  );

  /** Wire to the panel's root: `onMouseUp`. */
  return { onMouseUp: () => setTimeout(onSelect), onKey, chip };
}
