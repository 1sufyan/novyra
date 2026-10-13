/**
 * The only way server code talks to external services (docs/03-security.md §9, SSRF).
 * Each integration gets a client that can reach only its own hosts, over HTTPS, with a timeout,
 * and never follows a redirect to a host outside the allowlist.
 */

export class HttpRequestBlockedError extends Error {
  override name = "HttpRequestBlockedError";
}

export interface HttpClientOptions {
  /** Integration name, used in error messages. */
  name: string;
  /** Exact hostnames this client may call, e.g. ["api.resend.com"]. */
  allowedHosts: readonly string[];
  /** Per-request timeout in milliseconds (default 10 s). */
  timeoutMs?: number;
  /** Allow plain HTTP to localhost / 127.0.0.1 (local development and tests only). */
  allowInsecureLocalhost?: boolean;
  /** Redirects to follow when they stay within the allowlist (default 3). */
  maxRedirects?: number;
}

export type HttpFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const LOCALHOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function createHttpClient(options: HttpClientOptions): HttpFetch {
  const { name, timeoutMs = 10_000, allowInsecureLocalhost = false, maxRedirects = 3 } = options;
  const allowed = new Set(options.allowedHosts.map((host) => host.toLowerCase()));

  function assertAllowed(url: URL): void {
    const host = url.hostname.toLowerCase();
    if (!allowed.has(host)) {
      throw new HttpRequestBlockedError(`${name}: host "${host}" is not in the allowlist`);
    }
    const insecureOk = allowInsecureLocalhost && url.protocol === "http:" && LOCALHOSTS.has(host);
    if (url.protocol !== "https:" && !insecureOk) {
      throw new HttpRequestBlockedError(`${name}: only https:// requests are allowed`);
    }
  }

  return async function httpFetch(input, init = {}) {
    let url = new URL(input);
    const signal = init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    for (let redirects = 0; ; redirects++) {
      assertAllowed(url);
      const response = await fetch(url, { ...init, signal, redirect: "manual" });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) return response;
      if (redirects >= maxRedirects) throw new HttpRequestBlockedError(`${name}: too many redirects`);
      // Drain the redirect body so the connection can be reused.
      await response.body?.cancel();
      url = new URL(location, url);
    }
  };
}
