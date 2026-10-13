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
 */

export type IdempotencyConflictReason =
  /** Same key, different request body. */
  | "request_mismatch"
  /** Another request with this key is still running. */
  | "in_progress";

export class IdempotencyConflictError extends AppError {
  readonly reason: IdempotencyConflictReason;

  constructor(reason: IdempotencyConflictReason) {
    super(
      "idempotency_conflict",
      reason === "in_progress"
        ? "This request is already being processed."
        : "This idempotency key was already used for a different request.",
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

  try {
    const created = await prisma.idempotencyKey.create({
      data: { scope, key, subject, requestHash, status: "IN_PROGRESS", lockedUntil, expiresAt },
    });
    return { kind: "proceed", record: { id: created.id, scope, key } };
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
      expiresAt,
      responseBody: Prisma.DbNull,
      responseStatus: null,
      resourceType: null,
      resourceId: null,
    },
  });
  if (taken.count === 0) throw new IdempotencyConflictError("in_progress");
  return { kind: "proceed", record: { id: existing.id, scope, key } };
}

export interface CompletedResponse {
  response: Prisma.InputJsonValue;
  status?: number;
  resourceType?: string;
  resourceId?: string;
}

/** Records the response. Call it inside the command's own transaction so both commit together. */
export async function completeIdempotentRequest(
  db: PrismaClient | Tx,
  record: IdempotencyRecord,
  result: CompletedResponse,
): Promise<void> {
  await db.idempotencyKey.update({
    where: { id: record.id },
    data: {
      status: "COMPLETED",
      responseBody: result.response,
      responseStatus: result.status ?? 200,
      resourceType: result.resourceType ?? null,
      resourceId: result.resourceId ?? null,
      lockedUntil: null,
    },
  });
}

/** Releases the key after a failure, so the client may retry with the same key. */
export async function failIdempotentRequest(db: PrismaClient | Tx, record: IdempotencyRecord): Promise<void> {
  await db.idempotencyKey.update({ where: { id: record.id }, data: { status: "FAILED", lockedUntil: null } });
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
  try {
    const result = await handler();
    await completeIdempotentRequest(prisma, begun.record, result);
    return { replayed: false, response: result.response };
  } catch (error) {
    await failIdempotentRequest(prisma, begun.record);
    throw error;
  }
}
