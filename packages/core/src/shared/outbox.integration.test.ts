import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { testPrisma } from "../../tests/db.ts";
import { dispatchOutbox, enqueueOutboxEvent, outboxRetryDelayMs, type OutboxHandler } from "./outbox.ts";

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

// The dispatcher processes every due event, so each test starts from an empty queue.
beforeEach(async () => {
  await prisma.outboxEvent.deleteMany({});
});

async function enqueue(type: string, count = 1) {
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < count; i++) {
      await enqueueOutboxEvent(tx, { type, aggregateType: "order", aggregateId: String(i), payload: { i } });
    }
  });
}

describe("outbox dispatcher", () => {
  test("delivers events to their handler and marks them DONE", async () => {
    await enqueue("order.placed", 3);
    const seen: unknown[] = [];
    const stats = await dispatchOutbox(prisma, {
      workerId: "w1",
      handlers: { "order.placed": async (event) => void seen.push(event.payload) },
    });
    expect(stats).toMatchObject({ claimed: 3, done: 3, retried: 0, dead: 0 });
    expect(seen).toHaveLength(3);
    const rows = await prisma.outboxEvent.findMany();
    expect(rows.every((row) => row.status === "DONE" && row.processedAt && !row.lockedBy)).toBe(true);
  });

  test("an event written in a rolled-back transaction is never delivered", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueOutboxEvent(tx, {
          type: "order.placed",
          aggregateType: "order",
          aggregateId: "x",
          payload: {},
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const stats = await dispatchOutbox(prisma, { workerId: "w1", handlers: {} });
    expect(stats.claimed).toBe(0);
  });

  test("a failing handler is retried later with backoff, then succeeds", async () => {
    await enqueue("email.send");
    let calls = 0;
    const flaky: OutboxHandler = async () => {
      calls++;
      if (calls === 1) throw new Error("provider 503");
    };
    const first = await dispatchOutbox(prisma, { workerId: "w1", handlers: { "email.send": flaky } });
    expect(first).toMatchObject({ claimed: 1, retried: 1 });
    const pending = await prisma.outboxEvent.findFirstOrThrow();
    expect(pending.status).toBe("PENDING");
    expect(pending.lastError).toContain("provider 503");
    expect(pending.availableAt.getTime()).toBeGreaterThan(Date.now() + outboxRetryDelayMs(1) - 5_000);

    // Not due yet: nothing is claimed.
    expect(
      (await dispatchOutbox(prisma, { workerId: "w1", handlers: { "email.send": flaky } })).claimed,
    ).toBe(0);

    await prisma.outboxEvent.update({ where: { id: pending.id }, data: { availableAt: new Date() } });
    const second = await dispatchOutbox(prisma, { workerId: "w1", handlers: { "email.send": flaky } });
    expect(second).toMatchObject({ claimed: 1, done: 1 });
    expect((await prisma.outboxEvent.findFirstOrThrow()).attempts).toBe(2);
  });

  test("an event is DEAD after its last allowed attempt, and when no handler exists", async () => {
    await enqueue("always.fails");
    await enqueue("nobody.listens");
    const stats = await dispatchOutbox(prisma, {
      workerId: "w1",
      maxAttempts: 1,
      handlers: {
        "always.fails": async () => {
          throw new Error("boom");
        },
      },
    });
    expect(stats).toMatchObject({ claimed: 2, dead: 2 });
    const rows = await prisma.outboxEvent.findMany({ orderBy: { type: "asc" } });
    expect(rows.map((row) => [row.type, row.status])).toEqual([
      ["always.fails", "DEAD"],
      ["nobody.listens", "DEAD"],
    ]);
    expect(rows[1]!.lastError).toContain('No outbox handler registered for "nobody.listens"');
  });

  test("concurrent dispatchers deliver every event exactly once", async () => {
    await enqueue("order.placed", 40);
    const deliveries = new Map<string, number>();
    const handler: OutboxHandler = async (event) => {
      deliveries.set(event.id, (deliveries.get(event.id) ?? 0) + 1);
      await new Promise((resolve) => setTimeout(resolve, 2));
    };
    const runs = await Promise.all(
      ["a", "b", "c", "d"].map((worker) =>
        dispatchOutbox(prisma, { workerId: worker, batchSize: 15, handlers: { "order.placed": handler } }),
      ),
    );
    const claimedTotal = runs.reduce((sum, stats) => sum + stats.claimed, 0);
    const remaining = await dispatchOutbox(prisma, { workerId: "e", handlers: { "order.placed": handler } });
    expect(claimedTotal + remaining.claimed).toBe(40);
    expect(deliveries.size).toBe(40);
    expect([...deliveries.values()].every((count) => count === 1)).toBe(true);
  });

  test("events abandoned in PROCESSING by a crashed worker are released", async () => {
    await enqueue("order.placed");
    const event = await prisma.outboxEvent.findFirstOrThrow();
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: "PROCESSING",
        lockedBy: "crashed",
        lockedAt: new Date(Date.now() - 10 * 60 * 1000),
        attempts: 1,
      },
    });
    const stats = await dispatchOutbox(prisma, {
      workerId: "w2",
      handlers: { "order.placed": async () => {} },
    });
    expect(stats).toMatchObject({ released: 1, claimed: 1, done: 1 });
  });

  test("a worker that lost its lock cannot overwrite another worker's result", async () => {
    await enqueue("order.placed");
    const stats = await dispatchOutbox(prisma, {
      workerId: "slow",
      handlers: {
        "order.placed": async (event) => {
          // Simulate the stale-lock sweeper handing the event to another worker mid-flight.
          await prisma.outboxEvent.update({ where: { id: event.id }, data: { lockedBy: "other" } });
        },
      },
    });
    expect(stats).toMatchObject({ done: 0, lost: 1 });
    const row = await prisma.outboxEvent.findFirstOrThrow();
    expect(row.status).toBe("PROCESSING");
    expect(row.lockedBy).toBe("other");
  });
});
