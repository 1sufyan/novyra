import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "vitest";

import { testPrisma } from "../../tests/db.ts";
import { toPublicError } from "./errors.ts";
import {
  IdempotencyConflictError,
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  runIdempotent,
} from "./idempotency.ts";

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

const lapse = () => new Promise((resolve) => setTimeout(resolve, 20));

async function proceed(input: Parameters<typeof beginIdempotentRequest>[1]) {
  const begun = await beginIdempotentRequest(prisma, input);
  if (begun.kind !== "proceed") throw new Error("expected proceed");
  return begun.record;
}

const request = (overrides: Record<string, unknown> = {}) => ({
  scope: "test.command",
  key: randomUUID(),
  subject: "cart-1",
  request: { cartId: "cart-1", items: [{ sku: "RING-7", qty: 1 }] },
  ...overrides,
});

describe("idempotency", () => {
  test("runs once, then replays the stored response", async () => {
    const input = request();
    let runs = 0;
    const handler = async () => {
      runs++;
      return { response: { orderId: "o-1" }, resourceType: "order", resourceId: "o-1" };
    };
    const first = await runIdempotent(prisma, input, handler);
    const second = await runIdempotent(prisma, input, handler);
    expect(first).toEqual({ replayed: false, response: { orderId: "o-1" } });
    expect(second).toEqual({ replayed: true, response: { orderId: "o-1" } });
    expect(runs).toBe(1);
  });

  test("the request hash ignores key order", async () => {
    const input = request({ request: { a: 1, b: { c: 2, d: 3 } } });
    await runIdempotent(prisma, input, async () => ({ response: "done" }));
    const replay = await runIdempotent(
      prisma,
      { ...input, request: { b: { d: 3, c: 2 }, a: 1 } },
      async () => ({
        response: "again",
      }),
    );
    expect(replay).toEqual({ replayed: true, response: "done" });
  });

  test("rejects the same key with a different body or a different subject", async () => {
    const input = request();
    await runIdempotent(prisma, input, async () => ({ response: 1 }));
    await expect(
      beginIdempotentRequest(prisma, { ...input, request: { other: true } }),
    ).rejects.toMatchObject({
      reason: "request_mismatch",
    });
    await expect(beginIdempotentRequest(prisma, { ...input, subject: "cart-2" })).rejects.toMatchObject({
      reason: "request_mismatch",
    });
    const mismatch = await beginIdempotentRequest(prisma, { ...input, request: { other: true } }).catch(
      (error: unknown) => error,
    );
    expect(toPublicError(mismatch)).toMatchObject({ code: "idempotency_key_reused", status: 422 });
  });

  test("concurrent duplicates: exactly one proceeds, the rest see in_progress", async () => {
    const input = request();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => beginIdempotentRequest(prisma, input)),
    );
    const proceeded = results.filter((r) => r.status === "fulfilled" && r.value.kind === "proceed");
    const conflicts = results.filter(
      (r) =>
        r.status === "rejected" &&
        r.reason instanceof IdempotencyConflictError &&
        r.reason.reason === "in_progress",
    );
    expect(proceeded).toHaveLength(1);
    expect(conflicts).toHaveLength(5);
  });

  test("a failed attempt releases the key so the client can retry", async () => {
    const input = request();
    await expect(
      runIdempotent(prisma, input, async () => {
        throw new Error("payment provider timed out");
      }),
    ).rejects.toThrow("timed out");
    const retry = await runIdempotent(prisma, input, async () => ({ response: "ok" }));
    expect(retry).toEqual({ replayed: false, response: "ok" });
  });

  test("an abandoned attempt can be taken over once its lock lapses", async () => {
    const input = request({ lockMs: 1 });
    const first = await beginIdempotentRequest(prisma, input);
    expect(first.kind).toBe("proceed");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const takeover = await beginIdempotentRequest(prisma, input);
    expect(takeover.kind).toBe("proceed");
  });

  test("after a takeover, the earlier attempt can neither complete nor release the key", async () => {
    const input = request({ lockMs: 1 });
    const stale = await proceed(input);
    await lapse();
    const current = await proceed({ ...input, lockMs: 60_000 });

    await expect(completeIdempotentRequest(prisma, stale, { response: "stale" })).rejects.toMatchObject({
      reason: "lock_lost",
    });
    expect(await failIdempotentRequest(prisma, stale)).toBe(false);
    await expect(beginIdempotentRequest(prisma, input)).rejects.toMatchObject({ reason: "in_progress" });

    await completeIdempotentRequest(prisma, current, { response: "current" });
    const replay = await beginIdempotentRequest(prisma, input);
    expect(replay).toMatchObject({ kind: "replay", response: "current" });
  });

  test("a lost lock rolls back the earlier attempt's transaction", async () => {
    const input = request({ lockMs: 1 });
    const stale = await proceed(input);
    await lapse();
    await proceed({ ...input, lockMs: 60_000 });

    const aggregateId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.outboxEvent.create({
          data: { type: "test.order_placed", aggregateType: "order", aggregateId, payload: {} },
        });
        await completeIdempotentRequest(tx, stale, { response: "stale" });
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(await prisma.outboxEvent.count({ where: { aggregateId } })).toBe(0);
  });

  test("a handler that succeeded is not run again when storing its response fails", async () => {
    const input = request();
    let runs = 0;
    // PostgreSQL rejects \u0000 in jsonb, so the completion write fails after the handler ran.
    const handler = async () => {
      runs++;
      return { response: { providerRef: "PX-1", note: "ok\u0000" } };
    };
    await expect(runIdempotent(prisma, input, handler)).rejects.toThrow();
    await expect(runIdempotent(prisma, input, handler)).rejects.toMatchObject({ reason: "in_progress" });
    expect(runs).toBe(1);
  });

  test("a long-running attempt keeps its key: a retry can't take it over while the work runs", async () => {
    const input = request({ lockMs: 100 });
    let runs = 0;
    const first = runIdempotent(prisma, input, async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { response: "first" };
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(beginIdempotentRequest(prisma, input)).rejects.toMatchObject({ reason: "in_progress" });
    expect(await first).toEqual({ replayed: false, response: "first" });
    expect(await runIdempotent(prisma, input, async () => ({ response: "again" }))).toEqual({
      replayed: true,
      response: "first",
    });
    expect(runs).toBe(1);
  });

  test("completion can be written inside the caller's transaction", async () => {
    const input = request();
    const begun = await beginIdempotentRequest(prisma, input);
    if (begun.kind !== "proceed") throw new Error("expected proceed");
    await prisma.$transaction(async (tx) => {
      await completeIdempotentRequest(tx, begun.record, { response: { id: 42 }, status: 201 });
    });
    const row = await prisma.idempotencyKey.findUniqueOrThrow({ where: { id: begun.record.id } });
    expect(row).toMatchObject({ status: "COMPLETED", responseStatus: 201, responseBody: { id: 42 } });
  });
});
