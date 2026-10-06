import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FileStatus, Line } from "../shared/guide.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

export async function repoRoot(dir: string): Promise<string | undefined> {
  try {
    return (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    return undefined;
  }
}

export async function revParse(root: string, ref: string): Promise<string | undefined> {
  try {
    return (await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim();
  } catch {
    return undefined;
  }
}

export async function mergeBase(root: string, a: string, b: string): Promise<string> {
  return (await git(root, ["merge-base", a, b])).trim();
}

/** File contents at a commit, or in the working tree when `ref` is undefined. */
export async function fileAt(root: string, ref: string | undefined, path: string): Promise<string | undefined> {
  try {
    return ref ? await git(root, ["show", `${ref}:${path}`]) : await readFile(join(root, path), "utf8");
  } catch {
    return undefined;
  }
}

export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Untracked, non-ignored files in the working tree. */
async function untrackedFiles(root: string, path?: string): Promise<string[]> {
  const out = await git(root, ["ls-files", "-z", "--others", "--exclude-standard", ...(path ? ["--", path] : [])]);
  return out.split("\0").filter(Boolean);
}

/** Every file changed between `base` and `head` (working tree, including untracked files, when undefined). */
export async function changedFiles(root: string, base: string, head: string | undefined) {
  const range = head ? [base, head] : [base];
  // -z: paths come out verbatim instead of quoted/escaped.
  const [numstat, names, untracked] = await Promise.all([
    git(root, ["diff", "-z", "--no-renames", "--numstat", ...range]),
    git(root, ["diff", "-z", "--no-renames", "--name-status", ...range]),
    head ? [] : untrackedFiles(root),
  ]);
  const status = new Map<string, FileStatus>();
  const nameFields = names.split("\0");
  for (let i = 0; i + 1 < nameFields.length; i += 2) {
    const s = nameFields[i];
    status.set(nameFields[i + 1], s === "A" ? "added" : s === "D" ? "deleted" : "modified");
  }
  const files = numstat
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const [a, d, path] = row.split("\t");
      return {
        path,
        additions: a === "-" ? 0 : Number(a),
        deletions: d === "-" ? 0 : Number(d),
        status: status.get(path) ?? ("modified" as FileStatus),
      };
    });
  for (const path of untracked) {
    const text = await fileAt(root, undefined, path);
    files.push({ path, additions: text ? splitLines(text).length : 0, deletions: 0, status: "added" });
  }
  return files;
}

/** Status of a whole-file diff. A diff with no text lines (binary, mode-only) counts as modified. */
export function diffStatus(diff: RawLine[]): FileStatus {
  if (diff.length === 0) return "modified";
  if (diff.every((l) => l.k === "+")) return "added";
  if (diff.every((l) => l.k === "-")) return "deleted";
  return "modified";
}

export type RawLine = Omit<Line, "t"> & { text: string };

/**
 * The whole file as one diff: every line, marked context/added/removed.
 * Returns undefined when the file is unchanged.
 */
export async function fullFileDiff(
  root: string,
  base: string,
  head: string | undefined,
  path: string,
): Promise<RawLine[] | undefined> {
  const range = head ? [base, head] : [base];
  const out = await git(root, ["diff", "--no-color", "--no-renames", "--unified=100000000", ...range, "--", path]);
  if (!out.trim()) {
    // An untracked file is all additions when diffing against the working tree.
    if (head || (await untrackedFiles(root, path)).length === 0) return undefined;
    const text = await fileAt(root, undefined, path);
    return text === undefined ? undefined : splitLines(text).map((t, i) => ({ k: "+", n: i + 1, text: t }));
  }
  const lines: RawLine[] = [];
  let o = 0;
  let n = 0;
  let inHunk = false;
  for (const raw of splitLines(out)) {
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      o = Number(hunk[1]);
      n = Number(hunk[2]);
      // A "-0,0" or "+0,0" side means the file doesn't exist on that side.
      if (o === 0) o = 1;
      if (n === 0) n = 1;
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("\\")) continue;
    const k = raw[0];
    const text = raw.slice(1);
    if (k === "+") lines.push({ k: "+", n: n++, text });
    else if (k === "-") lines.push({ k: "-", o: o++, text });
    else if (k === " ") lines.push({ k: " ", o: o++, n: n++, text });
  }
  return lines;
}
