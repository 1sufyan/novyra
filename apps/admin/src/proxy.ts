import { NextResponse, type NextRequest } from "next/server";

import { buildCsp } from "@novyra/config/next/security-headers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin requests get a fresh nonce and a strict CSP with no 'unsafe-inline' scripts
 * (docs/03-security.md §12), plus the request id. Authorization happens next to the data,
 * not here (§4).
 */
export function proxy(request: NextRequest) {
  const incoming = request.headers.get("x-request-id");
  const requestId = incoming && UUID.test(incoming) ? incoming : crypto.randomUUID();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = buildCsp({
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"],
    // Next.js renders some <style> elements and style attributes without the nonce, and a nonce
    // can't cover attributes, so styles stay 'unsafe-inline' (as on the storefront). Scripts,
    // the real injection risk, still need the nonce.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  });

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-nonce", nonce);
  // Next.js reads the nonce from this request header and applies it to its own scripts.
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
