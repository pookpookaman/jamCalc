import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The engine is plain TypeScript with no build step, so every package resolves
 * it straight to source. One alias here keeps the CLI, the studio and the
 * tests all running the same code.
 */
export default defineConfig({
  test: {
    // Transforming the sources is the bulk of a run and does not change
    // between runs; caching it is Vitest's own suggestion and costs nothing
    // but a directory it manages itself.
    fsModuleCache: true,
  },
  resolve: {
    alias: {
      "@jamcalc/engine": fileURLToPath(
        new URL("./packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
});
