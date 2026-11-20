import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
// Hide review is on by default in the app; browser specs drive the Review tab, so start with it shown.
const storageState = baseURL
  ? {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [{ name: "career-ui.hideReview", value: "false" }],
        },
      ],
    }
  : undefined;
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL,
    storageState,
    headless: true,
    trace: "retain-on-failure",
  },
  reporter: "list",
  outputDir: ".cache/playwright",
});
