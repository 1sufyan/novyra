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
      ],
    });
    const report = await checkHealth(prisma);
    expect(report.status).toBe("degraded");
    expect(report.checks).toMatchObject({ deadOutboxEvents: 1, overdueOutboxEvents: 1 });
  });

  test("degraded, without throwing, when the database is unreachable", async () => {
    const unreachable = createPrismaClient("postgresql://nobody:wrong@127.0.0.1:1/none");
    const report = await checkHealth(unreachable);
    expect(report).toMatchObject({ status: "degraded", checks: { database: "unreachable" } });
    await unreachable.$disconnect();
  });
});
