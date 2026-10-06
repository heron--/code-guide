import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL("./src/ui", import.meta.url).pathname } },
  test: { include: ["src/**/*.test.ts"], testTimeout: 20_000 },
});
