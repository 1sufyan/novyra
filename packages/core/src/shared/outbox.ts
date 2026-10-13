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
  /** Identifies this dispatcher in locked_by (e.g. "cron:<request id>"). */
  workerId: string;
  batchSize?: number;
  /** After this many failed attempts the event is marked DEAD and needs a human (default 8). */
  maxAttempts?: number;
  /** PROCESSING rows locked longer than this are presumed abandoned and released (default 5 min). */
  staleAfterMs?: number;
  logger?: Logger;
}

export interface DispatchStats {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
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
 * Claims up to `batchSize` due events and runs their handlers. Concurrent dispatchers never claim
 * the same event (FOR UPDATE SKIP LOCKED).
 */
export async function dispatchOutbox(prisma: PrismaClient, options: DispatchOptions): Promise<DispatchStats> {
  const {
    handlers,
    workerId,
    batchSize = 50,
    maxAttempts = 8,
    staleAfterMs = 5 * 60 * 1000,
    logger,
  } = options;
  const stats: DispatchStats = { claimed: 0, done: 0, retried: 0, dead: 0, released: 0, lost: 0 };

  stats.released = await prisma.$executeRaw`
    UPDATE outbox_events
       SET status = 'PENDING', locked_at = NULL, locked_by = NULL
     WHERE status = 'PROCESSING'
       AND locked_at < now() - make_interval(secs => ${staleAfterMs / 1000})`;

  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE outbox_events
       SET status = 'PROCESSING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM outbox_events
        WHERE status = 'PENDING' AND available_at <= now()
        ORDER BY available_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED)
    RETURNING id, type, aggregate_type, aggregate_id, payload, attempts`;
  stats.claimed = claimed.length;

  for (const row of claimed) {
    const event: ClaimedOutboxEvent = {
      id: row.id,
      type: row.type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
      attempts: row.attempts,
    };
    // Only touch the row while this worker still holds it.
    const ours = { id: event.id, status: "PROCESSING" as const, lockedBy: workerId };
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
