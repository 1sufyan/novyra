import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "vitest";

import { testPrisma } from "../../tests/db.ts";
import {
  IdempotencyConflictError,
  beginIdempotentRequest,
  completeIdempotentRequest,
  runIdempotent,
} from "./idempotency.ts";

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

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
