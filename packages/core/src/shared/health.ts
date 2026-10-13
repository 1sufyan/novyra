import type { PrismaClient } from "@novyra/db";

/** Detailed health, for logs and alerts. Public endpoints expose only `status`. */
export interface HealthReport {
  readonly status: "ok" | "degraded";
  readonly checks: {
    readonly database: "ok" | "unreachable";
    /** Outbox events that need a human. */
    readonly deadOutboxEvents: number;
    /** PENDING events overdue by more than 10 minutes: the dispatcher isn't keeping up or isn't running. */
    readonly overdueOutboxEvents: number;
  };
}

export async function checkHealth(prisma: PrismaClient): Promise<HealthReport> {
  try {
    const [row] = await prisma.$queryRaw<{ dead: bigint; overdue: bigint }[]>`
      SELECT count(*) FILTER (WHERE status = 'DEAD') AS dead,
             count(*) FILTER (WHERE status = 'PENDING' AND available_at < now() - interval '10 minutes') AS overdue
        FROM outbox_events`;
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
  }
}
