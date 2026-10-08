/** Whether to show and accept Mac modifier keys (⌘, ⌥) rather than Ctrl and Alt. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The Option/Alt key as the reader's keyboard labels it. */
export const altKey = isMac ? "⌥" : "Alt";

/** A key, as every shortcut hint shows it. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="min-w-4 border border-border bg-surface-3 px-1 text-center font-mono text-[10.5px] leading-4 font-normal text-fg-2">
      {children}
    </kbd>
  );
}
