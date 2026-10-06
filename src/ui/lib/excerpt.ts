import type { Line, Range, ResolvedFile } from "../../shared/guide";

export const RANGE_CONTEXT = 2;
export const DIFF_CONTEXT = 3;
export const EXPAND_STEP = 20;

/** The number readers see for a line: new side, or old side in a deleted file. */
function num(file: ResolvedFile, l: Line) {
  return file.status === "deleted" ? l.o : l.n;
}

/**
 * Indices of the lines a range covers, including removed lines that sit
 * between or immediately before them.
 */
export function indexRange(file: ResolvedFile, r: Range): [number, number] | undefined {
  let start = -1;
  let end = -1;
  file.lines.forEach((l, i) => {
    const n = num(file, l);
    if (n === undefined) return;
    if (n >= r.start && n <= r.end) {
      if (start < 0) start = i;
      end = i;
    }
  });
  if (start < 0) return undefined;
  while (start > 0 && file.lines[start - 1].k === "-" && file.status !== "deleted") start--;
  return [start, end];
}

/** Which lines are shown before the reader expands anything. */
export function initialVisible(file: ResolvedFile, ranges?: Range[]): boolean[] {
  const n = file.lines.length;
  const vis = new Array<boolean>(n).fill(false);
  const show = (a: number, b: number) => {
    for (let i = Math.max(0, a); i <= Math.min(n - 1, b); i++) vis[i] = true;
  };
  if (ranges?.length) {
    for (const r of ranges) {
      const ir = indexRange(file, r);
      if (ir) show(ir[0] - RANGE_CONTEXT, ir[1] + RANGE_CONTEXT);
    }
  } else if (file.additions + file.deletions > 0) {
    file.lines.forEach((l, i) => l.k !== " " && show(i - DIFF_CONTEXT, i + DIFF_CONTEXT));
  } else {
    show(0, 19);
  }
  return vis;
}

/**
 * The nearest line above `idx` that encloses it (less indented, not a closer),
 * shown on a collapsed row like a diff hunk header.
 */
export function enclosingLine(lines: Line[], idx: number): { idx: number; text: string } | undefined {
  const text = (l: Line) => l.t.map((t) => t[0]).join("");
  const indent = (s: string) => s.match(/^\s*/)![0].replace(/\t/g, "    ").length;
  let first = idx;
  while (first < lines.length && !text(lines[first]).trim()) first++;
  if (first >= lines.length) return undefined;
  const level = indent(text(lines[first]));
  for (let i = idx - 1; i >= 0; i--) {
    const s = text(lines[i]);
    if (!s.trim() || /^\s*[)}\]]/.test(s) || /^\s*(\/\/|#|\*|\/\*)/.test(s)) continue;
    if (indent(s) < level) return { idx: i, text: s.trim() };
  }
  return undefined;
}
