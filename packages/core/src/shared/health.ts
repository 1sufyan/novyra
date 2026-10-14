import type { PrismaClient } from "@novyra/db";

/** Detailed health, for logs and alerts. Public endpoints expose only `status`. */
export interface HealthReport {
  readonly status: "ok" | "degraded";
  readonly checks: {
    readonly database: "ok" | "unreachable";
    /** Outbox events that need a human. */
    readonly deadOutboxEvents: number;
    /**
     * Events stuck for more than 10 minutes: PENDING past their due time, or PROCESSING with an
     * old lock. Either way the dispatcher isn't keeping up or isn't running.
     */
    readonly overdueOutboxEvents: number;
  };
}

export interface CheckHealthOptions {
  /** Report the database as unreachable when the check takes longer than this (default 3 s). */
  timeoutMs?: number;
}

class HealthTimeoutError extends Error {}

export async function checkHealth(
  prisma: PrismaClient,
  { timeoutMs = 3_000 }: CheckHealthOptions = {},
): Promise<HealthReport> {
  let timer: NodeJS.Timeout | undefined;
  try {
    // Each count is filtered so it can use an index: the table keeps every DONE event.
    const query = prisma.$queryRaw<{ dead: bigint; overdue: bigint }[]>`
      SELECT (SELECT count(*) FROM outbox_events WHERE status = 'DEAD') AS dead,
             (SELECT count(*) FROM outbox_events
               WHERE status = 'PENDING' AND available_at < now() - interval '10 minutes')
           + (SELECT count(*) FROM outbox_events
               WHERE status = 'PROCESSING' AND locked_at < now() - interval '10 minutes') AS overdue`;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HealthTimeoutError()), timeoutMs);
    });
    const [row] = await Promise.race([query, timeout]);
    const dead = Number(row?.dead ?? 0);
    const overdue = Number(row?.overdue ?? 0);
    return {
      status: dead === 0 && overdue === 0 ? "ok" : "degraded",
      checks: { database: "ok", deadOutboxEvents: dead, overdueOutboxEvents: overdue },
    };
  } catch {
    return {
      status: "degraded",
      checks: { database: "unreachable", deadOutboxEvents: 0, overdueOutboxEvents: 0 },
    };
  } finally {
    clearTimeout(timer);
  }
}
