/**
 * The only way server code talks to external services (docs/03-security.md §9, SSRF).
 * Each integration gets a client that can reach only its own hosts, over HTTPS, with a timeout.
 * Redirects are returned to the caller unless the integration opts in; followed redirects stay
 * within the allowlist and behave like fetch(): a 303 (or a 301/302 after a POST) becomes a
 * body-less GET, and credentials are dropped when the origin changes.
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
  /** Redirects to follow within the allowlist (default 0: a 3xx response is returned as is). */
  maxRedirects?: number;
}

export type HttpFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const LOCALHOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Headers that describe a request body; dropped when a redirect turns the request into a GET. */
const BODY_HEADERS = [
  "content-type",
  "content-length",
  "content-encoding",
  "content-language",
  "content-location",
];
/** Never sent to an origin other than the one the caller addressed. */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

export function createHttpClient(options: HttpClientOptions): HttpFetch {
  const { name, timeoutMs = 10_000, allowInsecureLocalhost = false, maxRedirects = 0 } = options;
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
    let method = (init.method ?? "GET").toUpperCase();
    let body = init.body;
    const headers = new Headers(init.headers);

    for (let redirects = 0; ; redirects++) {
      assertAllowed(url);
      const response = await fetch(url, { ...init, method, body, headers, signal, redirect: "manual" });
      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || !location || maxRedirects === 0) return response;
      if (redirects >= maxRedirects) throw new HttpRequestBlockedError(`${name}: too many redirects`);
      // Drain the redirect body so the connection can be reused.
      await response.body?.cancel();
      const next = new URL(location, url);

      const becomesGet =
        (response.status === 303 && method !== "GET" && method !== "HEAD") ||
        ((response.status === 301 || response.status === 302) && method === "POST");
      if (becomesGet) {
        method = "GET";
        body = undefined;
        for (const header of BODY_HEADERS) headers.delete(header);
      } else if (body instanceof ReadableStream) {
        throw new HttpRequestBlockedError(`${name}: a streamed request body cannot be sent again`);
      }
      if (next.origin !== url.origin) {
        for (const header of CREDENTIAL_HEADERS) headers.delete(header);
      }
      url = next;
    }
  };
}
