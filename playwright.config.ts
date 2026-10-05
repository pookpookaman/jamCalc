/**
 * Tests that drive the worksheet in a real browser: `npm run test:ui`.
 *
 * The unit tests cover decisions pulled out into plain functions. What they
 * cannot see is the wiring between a key, a click or a drag and what the page
 * does — which is where the last several regressions were. These press the
 * keys and click the regions.
 *
 * Locally they use the Edge that ships with Windows, so nothing is
 * downloaded; set PW_BROWSER=chromium (after `npx playwright install
 * chromium`) to use Playwright's own, as CI will.
 */

import { defineConfig } from "@playwright/test";

const PORT = 5180;

export default defineConfig({
  testDir: "e2e",
  // Not `.spec.ts`: the unit test runner picks those up.
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...(process.env["PW_BROWSER"] === "chromium" ? {} : { channel: "msedge" }),
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    // Its own port, so a dev server already running for editing is left alone.
    command: `npm run dev --workspace @jamcalc/studio -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
