import { useEffect, useState, type RefObject } from "react";
import type { ResolvedFile } from "../../shared/guide";
import type { ChatContext } from "../../shared/protocol";
import { useActions } from "./actions";
import { Icon } from "./Icon";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

type Selection = { context: ChatContext; label: string; x: number; y: number };

/**
 * Selecting code in a panel (or prose, if the panel says what it's from) offers to ask about it in Chat. Code is
 * found by the file card's `data-path` and each row's `data-idx`; `file` gives the lines behind them.
 */
export function useAskSelection(
  root: RefObject<HTMLElement | null>,
  opts: { file: (path: string) => ResolvedFile | undefined; prose?: (text: string) => ChatContext | undefined },
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
    if (card) {
      const path = card.getAttribute("data-path")!;
      const file = opts.file(path);
      if (!file) return setSelection(undefined);
      const idx = [sel.anchorNode, sel.focusNode]
        .map((n) => el(n)?.closest("[data-idx]")?.getAttribute("data-idx"))
        .filter((i): i is string => i != null)
        .map(Number);
      const nums = idx
        .map((i) => (file.status === "deleted" ? file.lines[i]?.o : (file.lines[i]?.n ?? file.lines[i]?.o)))
        .filter((n): n is number => n != null);
      if (!nums.length) return setSelection(undefined);
      const [start, end] = [Math.min(...nums), Math.max(...nums)];
      return setSelection({
        context: { kind: "code", path, start, end },
        label: start === end ? `Ask about line ${start}` : `Ask about lines ${start}–${end}`,
        ...at,
      });
    }
    const text = sel.toString().trim();
    const context = text && el(sel.anchorNode)?.closest("[data-prose]") ? opts.prose?.(text) : undefined;
    setSelection(context && { context, label: "Ask about this", ...at });
  };

  const askSelection = () => {
    if (!selection) return;
    ask(selection.context);
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
      <kbd className="min-w-4 border border-border bg-surface-3 px-1 text-center font-mono text-[10.5px] leading-4 text-fg-2">
        {isMac ? "⌘L" : "Ctrl+L"}
      </kbd>
    </div>
  );

  /** Wire to the panel's root: `onMouseUp`. */
  return { onMouseUp: () => setTimeout(onSelect), onKey, chip };
}
