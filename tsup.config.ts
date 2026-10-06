import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/server/cli.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: false,
  banner: { js: "#!/usr/bin/env node" },
});
