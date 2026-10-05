import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const engineSrc = fileURLToPath(
  new URL("../../packages/engine/src/index.ts", import.meta.url),
);

/**
 * The product's name, from the one place it is kept: `productName` in the
 * desktop package. The page title in the browser build comes from it too, so a
 * rename is one line.
 */
const desktop = JSON.parse(
  readFileSync(fileURLToPath(new URL("../desktop/package.json", import.meta.url)), "utf8"),
) as { productName: string; version: string };
const productName = desktop.productName;
const rootVersion = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as {
    version: string;
  }
).version;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "product-name",
      transformIndexHtml: (html) => html.replaceAll("__PRODUCT_NAME__", productName),
    },
    {
      // MIT asks that every copy carry the notices, and a hosted build is a
      // copy: the licence and THIRD-PARTY.md go out beside the page.
      name: "licence-notices",
      apply: "build",
      generateBundle() {
        const root = (file: string) => readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");
        this.emitFile({ type: "asset", fileName: "LICENSE.txt", source: root("LICENSE") });
        this.emitFile({ type: "asset", fileName: "THIRD-PARTY.md", source: root("THIRD-PARTY.md") });
      },
    },
  ],
  // Relative asset paths. The packaged app loads the page from disk, where an
  // absolute `/assets/...` means the root of the drive; a static host serving
  // from a subfolder has the same problem.
  base: "./",
  // The product version (ADR-0016), kept in the root package.json: shown on
  // the home screen, in a header's Version field, and recorded in every
  // sheet saved.
  define: { __APP_VERSION__: JSON.stringify(rootVersion) },
  resolve: {
    // Alias straight to engine source rather than a built artifact: the engine
    // is pure TypeScript with no build step, and this keeps edits live in dev.
    alias: { "@jamcalc/engine": engineSrc },
  },
  server: { port: 5173, open: false },
});
