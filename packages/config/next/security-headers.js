// Security headers shared by both Next.js apps (docs/03-security.md §12).

const isProduction = process.env.NODE_ENV === "production";

/**
 * @param {{ coop: "same-origin" | "same-origin-allow-popups", contentSecurityPolicy?: string }} options
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders({ coop, contentSecurityPolicy }) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(self)",
    },
    { key: "Cross-Origin-Opener-Policy", value: coop },
    { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  ];
  // HSTS only over real HTTPS deployments; browsers would pin it on any host that sends it.
  if (isProduction) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
  }
  if (contentSecurityPolicy) headers.push({ key: "Content-Security-Policy", value: contentSecurityPolicy });
  return headers;
}

/**
 * Joins CSP directives. In development React needs 'unsafe-eval' for fast refresh, and
 * upgrade-insecure-requests would break http://localhost, so both depend on the environment.
 *
 * @param {Record<string, string[]>} directives
 */
export function buildCsp(directives) {
  const all = { ...directives };
  if (!isProduction) all["script-src"] = [...(all["script-src"] ?? []), "'unsafe-eval'"];
  const parts = Object.entries(all).map(([name, values]) => [name, ...values].join(" "));
  if (isProduction) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
