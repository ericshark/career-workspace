import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
  },
  reporter: "list",
  outputDir: ".cache/playwright",
});
