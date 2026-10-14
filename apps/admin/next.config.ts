import type { NextConfig } from "next";

import { securityHeaders } from "@novyra/config/next/security-headers";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Don't write AGENTS.md / CLAUDE.md into the app when `next dev` detects an AI agent (as turbo.json's
  // agentGuidance: false does for the root).
  agentRules: false,
  transpilePackages: ["@novyra/core", "@novyra/db", "@novyra/env", "@novyra/auth"],
  async headers() {
    return [
      {
        source: "/:path*",
        // The nonce-based Content-Security-Policy is set per request in proxy.ts.
        headers: [
          ...securityHeaders({ coop: "same-origin" }),
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default config;
