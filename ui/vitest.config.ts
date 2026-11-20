import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    // Production waits up to 5 s for a held lock; tests that assert the "locked" failure must not.
    env: { CAREER_LOCK_WAIT_MS: "100" },
  },
});
