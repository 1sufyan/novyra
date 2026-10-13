import { setTimeout as sleep } from "node:timers/promises";

import type { Prisma, PrismaClient } from "./generated/prisma/client.ts";

/** The client handed to a transaction callback. */
export type Tx = Prisma.TransactionClient;

export interface TransactionOptions {
  /** Retries after a serialization failure or deadlock (default 3). */
  maxRetries?: number;
  /** The transaction is rolled back if it runs longer than this (default 10 s). */
  timeoutMs?: number;
  /** Maximum wait for a pooled connection (default 5 s). */
  maxWaitMs?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/** SQLSTATEs that mean "nothing was written, try again": serialization_failure, deadlock_detected. */
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
/** Prisma's code for the same conditions. */
const RETRYABLE_PRISMA_CODES = new Set(["P2034"]);

function isRetryableCode(code: unknown): boolean {
  return typeof code === "string" && (RETRYABLE_SQLSTATES.has(code) || RETRYABLE_PRISMA_CODES.has(code));
}

/** True when the database rolled the transaction back because of a write conflict or deadlock. */
export function isRetryableTransactionError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  // Driver adapters nest the original database error under `cause`.
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } };
      cause?: unknown;
    };
    if (
      isRetryableCode(candidate.code) ||
      isRetryableCode(candidate.meta?.code) ||
      isRetryableCode(candidate.meta?.driverAdapterError?.cause?.originalCode)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * Runs `fn` in one database transaction. Retries the whole callback on serialization failures and
 * deadlocks, so `fn` must not make network calls or have other side effects outside the database
 * (docs/02-database.md §5).
 */
export async function withTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const { maxRetries = 3, timeoutMs = 10_000, maxWaitMs = 5_000, isolationLevel } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        timeout: timeoutMs,
        maxWait: maxWaitMs,
        ...(isolationLevel ? { isolationLevel } : {}),
      });
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableTransactionError(error)) throw error;
      // Exponential backoff with full jitter: up to 50 ms, 100 ms, 200 ms…
      await sleep(Math.random() * 50 * 2 ** attempt);
    }
  }
}
