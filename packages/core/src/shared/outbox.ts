import type { Logger } from "pino";

import type { Prisma, PrismaClient, Tx } from "@novyra/db";

/**
 * Transactional outbox (docs/01-architecture.md §5). A service writes an event in the same
 * transaction as its state change; the dispatcher delivers it afterwards, at least once.
 * Handlers must therefore be idempotent.
 */

export interface OutboxEventInput {
  /** Dotted event name, e.g. "order.placed". */
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  /** Deliver no earlier than this (default: now). */
  availableAt?: Date;
}

/** Writes an event inside the caller's transaction. */
export async function enqueueOutboxEvent(tx: Tx, event: OutboxEventInput): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      ...(event.availableAt ? { availableAt: event.availableAt } : {}),
    },
  });
}

export interface ClaimedOutboxEvent {
  readonly id: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Prisma.JsonValue;
  /** Delivery attempt number, starting at 1. */
  readonly attempts: number;
}

export type OutboxHandler = (event: ClaimedOutboxEvent) => Promise<void>;

export interface DispatchOptions {
  handlers: Readonly<Record<string, OutboxHandler>>;
  /** Identifies this dispatcher run in locked_by (e.g. "cron:<request id>"). */
  workerId: string;
  /** Most events handled in one run (default 50). */
  batchSize?: number;
  /** After this many attempts the event is marked DEAD and needs a human (default 8). */
  maxAttempts?: number;
  /**
   * A PROCESSING event locked longer than this is presumed abandoned (its worker crashed, was killed
   * or hung) and is retried, or marked DEAD once it has used maxAttempts (default 5 min). Keep it
   * well above the slowest handler: a handler still running past it may be delivered twice.
   */
  staleAfterMs?: number;
  /**
   * Stop claiming new events after this long, so a run finishes inside its platform's time limit
   * (default: no limit). An event already claimed is always finished.
   */
  timeBudgetMs?: number;
  logger?: Logger;
}

export interface DispatchStats {
  claimed: number;
  done: number;
  retried: number;
  /** Events marked DEAD, including abandoned events that had used all their attempts. */
  dead: number;
  /** Abandoned events returned to the queue for another attempt. */
  released: number;
  /** Finished after another worker had taken the event over; that worker's outcome stands. */
  lost: number;
}

/** Delay before retry `attempt` (1-based): 30 s, 1 min, 2 min … capped at 1 h. */
export function outboxRetryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
}

const MAX_ERROR_LENGTH = 2000;

function describe(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
}

interface ClaimedRow {
  id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

/**
 * Handles up to `batchSize` due events, one at a time. Each event is claimed (FOR UPDATE SKIP
 * LOCKED) just before its handler runs, so concurrent dispatchers never claim the same event and a
 * long run never holds events it has not started.
 */
export async function dispatchOutbox(prisma: PrismaClient, options: DispatchOptions): Promise<DispatchStats> {
  const {
    handlers,
    workerId,
    batchSize = 50,
    maxAttempts = 8,
    staleAfterMs = 5 * 60 * 1000,
    timeBudgetMs = Number.POSITIVE_INFINITY,
    logger,
  } = options;
  const stats: DispatchStats = { claimed: 0, done: 0, retried: 0, dead: 0, released: 0, lost: 0 };
  const startedAt = Date.now();

  // Abandoned events count as a failed attempt: retried after the stale window, or DEAD when out of
  // attempts, so an event whose handler never returns cannot cycle forever.
  const abandoned = await prisma.$queryRaw<{ id: string; type: string; attempts: number; dead: boolean }[]>`
    UPDATE outbox_events
       SET status = CASE WHEN attempts >= ${maxAttempts} THEN 'DEAD'::outbox_status
                         ELSE 'PENDING'::outbox_status END,
           locked_at = NULL,
           locked_by = NULL,
           last_error = 'Abandoned: no result within the stale window (worker crashed, killed or hung)'
     WHERE status = 'PROCESSING'
       AND locked_at < now() - make_interval(secs => ${staleAfterMs / 1000})
    RETURNING id, type, attempts, status = 'DEAD' AS dead`;
  for (const row of abandoned) {
    if (row.dead) {
      stats.dead++;
      logger?.error({ eventId: row.id, type: row.type, attempts: row.attempts }, "outbox event is dead");
    } else {
      stats.released++;
    }
  }

  while (stats.claimed < batchSize && Date.now() - startedAt < timeBudgetMs) {
    const [row] = await prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_events
         SET status = 'PROCESSING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
       WHERE id = (
         SELECT id FROM outbox_events
          WHERE status = 'PENDING' AND available_at <= now()
          ORDER BY available_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED)
      RETURNING id, type, aggregate_type, aggregate_id, payload, attempts`;
    if (!row) break;
    stats.claimed++;

    const event: ClaimedOutboxEvent = {
      id: row.id,
      type: row.type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
      attempts: row.attempts,
    };
    // Only touch the row while this claim still holds it. Every claim increments attempts, so
    // (lockedBy, attempts) identifies this claim even if a worker id is reused.
    const ours = {
      id: event.id,
      status: "PROCESSING" as const,
      lockedBy: workerId,
      attempts: event.attempts,
    };
    const handler = handlers[event.type];

    try {
      if (!handler) throw new Error(`No outbox handler registered for "${event.type}"`);
      await handler(event);
      const { count } = await prisma.outboxEvent.updateMany({
        where: ours,
        data: { status: "DONE", processedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
      });
      if (count === 1) stats.done++;
      else stats.lost++;
    } catch (error) {
      const lastError = describe(error);
      if (!handler || event.attempts >= maxAttempts) {
        const { count } = await prisma.outboxEvent.updateMany({
          where: ours,
          data: { status: "DEAD", lockedAt: null, lockedBy: null, lastError },
        });
        if (count === 0) {
          stats.lost++;
          continue;
        }
        stats.dead++;
        logger?.error(
          { eventId: event.id, type: event.type, attempts: event.attempts },
          "outbox event is dead",
        );
      } else {
        const { count } = await prisma.outboxEvent.updateMany({
          where: ours,
          data: {
            status: "PENDING",
            lockedAt: null,
            lockedBy: null,
            lastError,
            availableAt: new Date(Date.now() + outboxRetryDelayMs(event.attempts)),
          },
        });
        if (count === 0) {
          stats.lost++;
          continue;
        }
        stats.retried++;
        logger?.warn(
          { eventId: event.id, type: event.type, attempts: event.attempts },
          "outbox event will retry",
        );
      }
    }
  }
  return stats;
}
