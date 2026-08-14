import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Points straight at the shared package's TS source so vite dev/build never needs it
      // pre-compiled — only `tsc --noEmit` (via the tsconfig "paths" below) cares about dist/.
      "@project-visualizer/shared/graph.js": fileURLToPath(
        new URL("../packages/shared/src/graph.ts", import.meta.url),
      ),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:4173",
    },
  },
  build: {
    outDir: "dist",
  },
});
