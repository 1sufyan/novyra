import { NextResponse, type NextRequest } from "next/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cheap request gating only; never a security boundary (docs/03-security.md §4).
 * Assigns the request id that flows into logs, audit entries and provider calls.
 */
export function proxy(request: NextRequest) {
  const incoming = request.headers.get("x-request-id");
  // Accept an upstream id only if it is a UUID, so clients can't inject arbitrary log content.
  const requestId = incoming && UUID.test(incoming) ? incoming : crypto.randomUUID();

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
