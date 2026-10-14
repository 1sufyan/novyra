import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient, type Tx } from "@novyra/db";

import { canonicalJson, sha256Hex } from "./crypto.ts";
import { AppError } from "./errors.ts";

/**
 * Server-side idempotency for commands that must not run twice: place order, initiate payment,
 * create refund (docs/03-security.md §11). Backed by the idempotency_keys table.
 *
 *   const begun = await beginIdempotentRequest(prisma, { scope, key, subject, request });
 *   if (begun.kind === "replay") return begun.response;
 *   … do the work; in the same transaction, call completeIdempotentRequest(tx, begun.record, …)
 *
 * A key is held for `lockMs`. If the attempt is still running when that lapses, a retry may take the
 * key over; the earlier attempt then holds a stale token, so its completeIdempotentRequest throws
 * (rolling its transaction back) and its failIdempotentRequest is a no-op. Choose `lockMs` longer
 * than the command's worst case, and pass the key on to providers that accept one, because side
 * effects outside the database cannot be rolled back.
 */

export type IdempotencyConflictReason =
  /** Same key, different request body or owner (422: the client must use a new key). */
  | "request_mismatch"
  /** Another request with this key is still running (409: retry later with the same key). */
  | "in_progress"
  /** This attempt's lock lapsed and a newer attempt took the key over (409). */
  | "lock_lost";

export class IdempotencyConflictError extends AppError {
  readonly reason: IdempotencyConflictReason;

  constructor(reason: IdempotencyConflictReason) {
    super(
      reason === "request_mismatch" ? "idempotency_key_reused" : "idempotency_conflict",
      reason === "request_mismatch"
        ? "This idempotency key was already used for a different request."
        : "This request is already being processed.",
      { expose: true },
    );
    this.reason = reason;
  }
}

export interface IdempotentRequest {
  /** What kind of command, e.g. "checkout.place_order". */
  scope: string;
  /** Client-supplied key (a UUID generated when the form rendered). */
  key: string;
  /** Owner of the key (user id or cart id). A key can't be replayed by another subject. */
  subject?: string;
  /** The command input; its canonical hash detects key reuse with a different body. */
  request: unknown;
  /** How long a completed response stays replayable (default 24 h). */
  ttlMs?: number;
  /** How long a running request holds the key before another attempt may take over (default 60 s). */
  lockMs?: number;
}

export interface IdempotencyRecord {
  readonly id: string;
  readonly scope: string;
  readonly key: string;
  /** Proves this attempt still holds the key. */
  readonly lockToken: string;
}

export type BeginResult =
  | { readonly kind: "proceed"; readonly record: IdempotencyRecord }
  | { readonly kind: "replay"; readonly response: Prisma.JsonValue; readonly resourceId: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function beginIdempotentRequest(
  prisma: PrismaClient,
  input: IdempotentRequest,
): Promise<BeginResult> {
  const { scope, key, subject = null, ttlMs = DAY_MS, lockMs = 60_000 } = input;
  const requestHash = sha256Hex(canonicalJson(input.request));
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + lockMs);
  const expiresAt = new Date(now.getTime() + ttlMs);
  const lockToken = randomUUID();

  try {
    const created = await prisma.idempotencyKey.create({
      data: { scope, key, subject, requestHash, status: "IN_PROGRESS", lockedUntil, lockToken, expiresAt },
    });
    return { kind: "proceed", record: { id: created.id, scope, key, lockToken } };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const existing = await prisma.idempotencyKey.findUniqueOrThrow({ where: { scope_key: { scope, key } } });
  const expired = existing.expiresAt <= now;

  if (!expired) {
    // A different owner or body is treated the same way, so the response never reveals which.
    if (existing.requestHash !== requestHash || existing.subject !== subject) {
      throw new IdempotencyConflictError("request_mismatch");
    }
    if (existing.status === "COMPLETED") {
      return { kind: "replay", response: existing.responseBody, resourceId: existing.resourceId };
    }
    if (existing.status === "IN_PROGRESS" && existing.lockedUntil && existing.lockedUntil > now) {
      throw new IdempotencyConflictError("in_progress");
    }
  }

  // Expired, failed, or abandoned (lock lapsed): take it over, unless someone else just did.
  const taken = await prisma.idempotencyKey.updateMany({
    where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
    data: {
      subject,
      requestHash,
      status: "IN_PROGRESS",
      lockedUntil,
      lockToken,
      expiresAt,
      responseBody: Prisma.DbNull,
      responseStatus: null,
      resourceType: null,
      resourceId: null,
    },
  });
  if (taken.count === 0) throw new IdempotencyConflictError("in_progress");
  return { kind: "proceed", record: { id: existing.id, scope, key, lockToken } };
}

/** Matches the row only while `record`'s attempt still holds it. */
function heldBy(record: IdempotencyRecord) {
  return { id: record.id, status: "IN_PROGRESS" as const, lockToken: record.lockToken };
}

export interface CompletedResponse {
  response: Prisma.InputJsonValue;
  status?: number;
  resourceType?: string;
  resourceId?: string;
}

/**
 * Records the response. Call it inside the command's own transaction so both commit together.
 * Throws IdempotencyConflictError("lock_lost") when a newer attempt has taken the key over, which
 * rolls that transaction back.
 */
export async function completeIdempotentRequest(
  db: PrismaClient | Tx,
  record: IdempotencyRecord,
  result: CompletedResponse,
): Promise<void> {
  const { count } = await db.idempotencyKey.updateMany({
    where: heldBy(record),
    data: {
      status: "COMPLETED",
      responseBody: result.response,
      responseStatus: result.status ?? 200,
      resourceType: result.resourceType ?? null,
      resourceId: result.resourceId ?? null,
      lockedUntil: null,
      lockToken: null,
    },
  });
  if (count === 0) throw new IdempotencyConflictError("lock_lost");
}

/**
 * Releases the key after a failure, so the client may retry with the same key. Does nothing when a
 * newer attempt holds the key; returns whether the key was released.
 */
export async function failIdempotentRequest(
  db: PrismaClient | Tx,
  record: IdempotencyRecord,
): Promise<boolean> {
  const { count } = await db.idempotencyKey.updateMany({
    where: heldBy(record),
    data: { status: "FAILED", lockedUntil: null, lockToken: null },
  });
  return count === 1;
}

/**
 * Convenience wrapper for commands whose work doesn't need to share a transaction with the
 * idempotency record. Returns the stored response on replay.
 */
export async function runIdempotent<T extends Prisma.InputJsonValue>(
  prisma: PrismaClient,
  input: IdempotentRequest,
  handler: () => Promise<{ response: T; status?: number; resourceType?: string; resourceId?: string }>,
): Promise<{ replayed: boolean; response: T | Prisma.JsonValue }> {
  const begun = await beginIdempotentRequest(prisma, input);
  if (begun.kind === "replay") return { replayed: true, response: begun.response };
  let result: Awaited<ReturnType<typeof handler>>;
  try {
    result = await handler();
  } catch (error) {
    await failIdempotentRequest(prisma, begun.record);
    throw error;
  }
  // The handler succeeded, so the key is never released from here: if storing the response fails,
  // it stays IN_PROGRESS until its lock lapses rather than letting a retry run the handler again.
  await completeIdempotentRequest(prisma, begun.record, result);
  return { replayed: false, response: result.response };
}
