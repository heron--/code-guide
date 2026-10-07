import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/ui",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src/ui") } },
  build: { outDir: resolve(import.meta.dirname, "dist/ui"), emptyOutDir: true },
  // `npm run dev` proxies the API to a running `code-guide --no-open` server.
  server: { proxy: { "/api": "http://localhost:4646" } },
});
