import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
/**
 * The commit this build is from, so a running Code Guide can say whether it's up to date: "-dirty" when the
 * build includes uncommitted changes to tracked files. Empty outside git.
 */
function commit(): string {
  const git = (...args: string[]) =>
    execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  try {
    return (
      git("rev-parse", "--short=5", "HEAD") + (git("status", "--porcelain", "--untracked-files=no") ? "-dirty" : "")
    );
  } catch {
    return "";
  }
}

export default defineConfig({
  entry: { cli: "src/server/cli.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: false,
  banner: { js: "#!/usr/bin/env node" },
  define: { __VERSION__: JSON.stringify(version), __COMMIT__: JSON.stringify(commit()) },
});
