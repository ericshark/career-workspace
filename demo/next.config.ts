import type { NextConfig } from "next";

// The app's API code runs in the browser here, so its Node imports resolve to small shims.
const shim = (name: string) => `./src/shims/${name}.ts`;
const config: NextConfig = {
  output: "export",
  // The in-memory workspace root (see src/demo/seed.ts).
  env: { CAREER_ROOT: "/workspace" },
  agentRules: false,
  devIndicators: false,
  turbopack: {
    resolveAlias: {
      "node:fs": { browser: shim("fs") },
      "node:fs/promises": { browser: shim("fs-promises") },
      "node:path": { browser: "path-browserify" },
      "node:child_process": { browser: shim("child-process") },
      "next/server": { browser: shim("next-server") },
    },
  },
};
export default config;
