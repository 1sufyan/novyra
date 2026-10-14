import type { NextConfig } from "next";

import { buildCsp, securityHeaders } from "@novyra/config/next/security-headers";

// Allowlist CSP for the cached storefront. Third-party hosts are added as integrations land
// (docs/03-security.md §12 explains the 'unsafe-inline' trade-off).
const contentSecurityPolicy = buildCsp({
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
});

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
        headers: securityHeaders({ coop: "same-origin-allow-popups", contentSecurityPolicy }),
      },
    ];
  },
};

export default config;
