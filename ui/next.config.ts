import type { NextConfig } from "next";

const config: NextConfig = {
  // Verification builds set NEXT_DIST_DIR (e.g. .cache/next-verify) so they never overwrite the
  // build that a running server is serving from .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Keep the Claude Agent SDK native binaries out of the bundler.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  // Keep `next dev` from adding its own AGENTS.md to the checkout.
  agentRules: false,
  // Hide the floating "N" dev badge; compile/runtime errors still show as overlays.
  devIndicators: false,
  async redirects() {
    return [
      // Analytics was merged into the Dashboard.
      { source: "/analytics", destination: "/", permanent: false },
    ];
  },
};

export default config;
