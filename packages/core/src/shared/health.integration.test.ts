import { createServer, type Socket } from "node:net";

import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { createPrismaClient } from "@novyra/db";

import { testPrisma } from "../../tests/db.ts";
import { checkHealth } from "./health.ts";

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await prisma.outboxEvent.deleteMany({});
});

describe("checkHealth", () => {
  test("ok with a reachable database and a healthy outbox", async () => {
    expect(await checkHealth(prisma)).toEqual({
      status: "ok",
      checks: { database: "ok", deadOutboxEvents: 0, overdueOutboxEvents: 0 },
    });
  });

  test("degraded when events are dead or overdue", async () => {
    await prisma.outboxEvent.createMany({
      data: [
        { type: "x", aggregateType: "t", aggregateId: "1", payload: {}, status: "DEAD" },
        {
          type: "x",
          aggregateType: "t",
          aggregateId: "2",
          payload: {},
          availableAt: new Date(Date.now() - 60 * 60 * 1000),
        },
        {
          type: "x",
          aggregateType: "t",
          aggregateId: "3",
          payload: {},
          status: "PROCESSING",
          lockedBy: "gone",
          lockedAt: new Date(Date.now() - 60 * 60 * 1000),
        },
        { type: "x", aggregateType: "t", aggregateId: "4", payload: {}, status: "DONE" },
      ],
    });
    const report = await checkHealth(prisma);
    expect(report.status).toBe("degraded");
    expect(report.checks).toMatchObject({ deadOutboxEvents: 1, overdueOutboxEvents: 2 });
  });

  test("degraded, without throwing, when the database is unreachable", async () => {
    const unreachable = createPrismaClient("postgresql://nobody:wrong@127.0.0.1:1/none");
    const report = await checkHealth(unreachable);
    expect(report).toMatchObject({ status: "degraded", checks: { database: "unreachable" } });
    await unreachable.$disconnect();
  });

  test("degraded within its deadline when the database accepts connections but never answers", async () => {
    const sockets = new Set<Socket>();
    const silent = createServer((socket) => void sockets.add(socket));
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as { port: number };
    const hung = createPrismaClient(`postgresql://nobody:wrong@127.0.0.1:${port}/none`);
    try {
      const started = Date.now();
      const report = await checkHealth(hung, { timeoutMs: 300 });
      expect(report).toMatchObject({ status: "degraded", checks: { database: "unreachable" } });
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      silent.close();
      await hung.$disconnect().catch(() => undefined);
    }
  });
});
