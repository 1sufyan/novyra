import { checkPlatformHealth } from "@novyra/core/platform";

export const dynamic = "force-dynamic";

/** Uptime probe. Exposes only ok / degraded, never internals (docs/03-security.md §10). */
export async function GET() {
  const { status } = await checkPlatformHealth();
  return Response.json(
    { status },
    { status: status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
