/** Marks a title this module set, so it never overwrites (or removes) a title a component gave. */
const OURS = "data-truncated-title";

/**
 * Hovering text cut short with an ellipsis (Tailwind's `truncate`) shows the whole text as a tooltip. One
 * listener for the page, so no component has to remember; a title a component sets itself wins.
 */
export function showTruncatedText(root: Document = document): () => void {
  const over = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.(".truncate");
    if (!(el instanceof HTMLElement)) return;
    if (el.hasAttribute("title") && !el.hasAttribute(OURS)) return;
    if (el.scrollWidth > el.clientWidth) {
      el.title = el.textContent?.trim() ?? "";
      el.setAttribute(OURS, "");
    } else if (el.hasAttribute(OURS)) {
      el.removeAttribute("title");
      el.removeAttribute(OURS);
    }
  };
  root.addEventListener("pointerover", over);
  return () => root.removeEventListener("pointerover", over);
}
