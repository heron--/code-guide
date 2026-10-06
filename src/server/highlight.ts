import { createHighlighter, bundledLanguages, type Highlighter } from "shiki";
import type { Token } from "../shared/guide.js";

const THEMES = { light: "github-light", dark: "github-dark" } as const;
const MAX_LINES = 20_000;

const EXT: Record<string, string> = {
  h: "c",
  hpp: "cpp",
  cc: "cpp",
  mjs: "js",
  cjs: "js",
  mts: "ts",
  cts: "ts",
  bazel: "python",
  bzl: "python",
  yml: "yaml",
  zsh: "bash",
  sh: "bash",
  kt: "kotlin",
};

const NAMES: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "make",
  BUILD: "python",
  WORKSPACE: "python",
};

export function languageFor(path: string): string | undefined {
  const name = path.split("/").pop()!;
  if (NAMES[name]) return NAMES[name];
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const lang = EXT[ext] ?? ext;
  return lang in bundledLanguages ? lang : undefined;
}

let highlighter: Promise<Highlighter> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighter({ themes: Object.values(THEMES), langs: [] });
  return highlighter;
}

/** Tokenize lines of one file. Falls back to plain text on unknown languages or huge files. */
export async function highlight(path: string, lines: string[]): Promise<Token[][]> {
  const lang = languageFor(path);
  if (!lang || lines.length > MAX_LINES) return lines.map((l) => [[l]]);
  const h = await getHighlighter();
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang as never);
  const { tokens } = h.codeToTokens(lines.join("\n"), { lang: lang as never, themes: THEMES });
  return lines.map((line, i) =>
    tokens[i]
      ? tokens[i].map((t): Token => {
          const style = t.htmlStyle as Record<string, string> | undefined;
          return [t.content, style?.color, style?.["--shiki-dark"]];
        })
      : [[line]],
  );
}
