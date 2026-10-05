/**
 * The product's name, as the build wrote it into the page title.
 *
 * Read once, when the app loads and before anything retitles the page after a
 * sheet. The name itself is kept in one place — `productName` in
 * apps/desktop/package.json — and injected into the title at build time.
 */
declare const __APP_VERSION__: string;

/** The version doing the printing, for a header's Version field. */
export const VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

export const PRODUCT: string =
  typeof document !== "undefined" && document.title !== "__PRODUCT_NAME__" ? document.title : "";
