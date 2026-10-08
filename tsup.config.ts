import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
/** The commit this build is from, so a running Code Guide can say whether it's up to date. Empty outside git. */
function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=5", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
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
