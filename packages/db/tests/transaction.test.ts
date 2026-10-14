/**
 * withTransaction() against a real PostgreSQL: deadlocks are retried, other errors are not.
 *
 *   pnpm db:test:prepare && pnpm db:test      (TEST_DATABASE_URL from the root .env or the shell)
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";

import "../load-env.ts";
import { createPrismaClient } from "../src/client.ts";
import { isRetryableTransactionError, withTransaction, type Tx } from "../src/transaction.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL must point to a disposable database with migrations applied.");
}

const prisma = createPrismaClient(url);
after(() => prisma.$disconnect());

async function createTwoStockRows() {
  const suffix = randomUUID().slice(0, 8);
  const location = await prisma.inventoryLocation.create({ data: { code: `TX-${suffix}`, name: "Vault" } });
  const product = await prisma.product.create({
    data: {
      slug: `tx-${suffix}`,
      name: "Pendant",
      variants: {
        create: [
          { sku: `TX-A-${suffix}`, title: "A", price: "1000.00" },
          { sku: `TX-B-${suffix}`, title: "B", price: "1000.00" },
        ],
      },
    },
    include: { variants: true },
  });
  const [a, b] = await Promise.all(
    product.variants.map((variant) =>
      prisma.inventoryLevel.create({ data: { variantId: variant.id, locationId: location.id, onHand: 10 } }),
    ),
  );
  return { a: a!, b: b! };
}

/** Locks `first`, waits so the other transaction can lock `second`, then locks `second`. */
function crossUpdate(firstId: string, secondId: string) {
  return async (tx: Tx) => {
    await tx.$executeRaw`UPDATE inventory_levels SET on_hand = on_hand + 1 WHERE id = ${firstId}::uuid`;
    await tx.$executeRaw`SELECT pg_sleep(0.3)`;
    await tx.$executeRaw`UPDATE inventory_levels SET on_hand = on_hand + 1 WHERE id = ${secondId}::uuid`;
  };
}

describe("withTransaction", () => {
  test("a deadlock surfaces as a retryable error when retries are disabled", async () => {
    const { a, b } = await createTwoStockRows();
    const results = await Promise.allSettled([
      withTransaction(prisma, crossUpdate(a.id, b.id), { maxRetries: 0 }),
      withTransaction(prisma, crossUpdate(b.id, a.id), { maxRetries: 0 }),
    ]);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(failures.length, 1, "PostgreSQL aborts exactly one side of the deadlock");
    assert.ok(isRetryableTransactionError(failures[0]!.reason), String(failures[0]!.reason));
  });

  test("retries the deadlock victim so both transactions commit", async () => {
    const { a, b } = await createTwoStockRows();
    await Promise.all([
      withTransaction(prisma, crossUpdate(a.id, b.id)),
      withTransaction(prisma, crossUpdate(b.id, a.id)),
    ]);
    const rows = await prisma.inventoryLevel.findMany({ where: { id: { in: [a.id, b.id] } } });
    assert.deepEqual(
      rows.map((row) => row.onHand),
      [12, 12],
      "each row was incremented once by each transaction",
    );
  });

  test("retries a SERIALIZABLE write-skew conflict raised at commit", async () => {
    const { a, b } = await createTwoStockRows();
    let calls = 0;
    // Each transaction reads both rows, then writes its own: a read/write dependency cycle that
    // PostgreSQL breaks by failing one COMMIT with 40001.
    const writeSkew = (ownId: string) => async (tx: Tx) => {
      calls++;
      await tx.$queryRaw`SELECT sum(on_hand) FROM inventory_levels WHERE id IN (${a.id}::uuid, ${b.id}::uuid)`;
      await tx.$executeRaw`SELECT pg_sleep(0.3)`;
      await tx.$executeRaw`UPDATE inventory_levels SET on_hand = on_hand + 1 WHERE id = ${ownId}::uuid`;
    };
    const options = { isolationLevel: "Serializable" as const };

    const unretried = await Promise.allSettled([
      withTransaction(prisma, writeSkew(a.id), { ...options, maxRetries: 0 }),
      withTransaction(prisma, writeSkew(b.id), { ...options, maxRetries: 0 }),
    ]);
    const failures = unretried.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(failures.length, 1, "PostgreSQL fails exactly one side");
    assert.ok(isRetryableTransactionError(failures[0]!.reason), String(failures[0]!.reason));

    calls = 0;
    await Promise.all([
      withTransaction(prisma, writeSkew(a.id), options),
      withTransaction(prisma, writeSkew(b.id), options),
    ]);
    assert.ok(calls >= 3, `the victim ran again (calls: ${calls})`);
    const rows = await prisma.inventoryLevel.findMany({ where: { id: { in: [a.id, b.id] } } });
    assert.equal(
      rows.reduce((total, row) => total + row.onHand, 0),
      23,
      "one commit from the unretried round and both from the retried round",
    );
  });

  test("rolls back and does not retry ordinary failures", async () => {
    const { a } = await createTwoStockRows();
    let calls = 0;
    await assert.rejects(
      withTransaction(prisma, async (tx) => {
        calls++;
        await tx.inventoryLevel.update({ where: { id: a.id }, data: { onHand: 99 } });
        // Violates inventory_levels_reserved_chk.
        await tx.inventoryLevel.update({ where: { id: a.id }, data: { reserved: 1000 } });
      }),
      /inventory_levels_reserved_chk/,
    );
    assert.equal(calls, 1);
    const row = await prisma.inventoryLevel.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(row.onHand, 10, "the first update was rolled back");
  });

  test("aborts a transaction that exceeds its timeout", async () => {
    await assert.rejects(
      withTransaction(
        prisma,
        async (tx) => {
          await tx.$executeRaw`SELECT pg_sleep(1)`;
        },
        { timeoutMs: 200 },
      ),
    );
  });
});

describe("isRetryableTransactionError", () => {
  test("recognises SQLSTATEs and Prisma codes, including nested causes", () => {
    assert.equal(isRetryableTransactionError({ code: "P2034" }), true);
    assert.equal(isRetryableTransactionError({ code: "40001" }), true);
    assert.equal(isRetryableTransactionError(new Error("wrapped", { cause: { code: "40P01" } })), true);
    assert.equal(
      isRetryableTransactionError(
        new Error("commit", { cause: { kind: "TransactionWriteConflict", originalCode: "40001" } }),
      ),
      true,
    );
    assert.equal(isRetryableTransactionError({ code: "23505" }), false);
    assert.equal(isRetryableTransactionError(new Error("plain")), false);
    assert.equal(isRetryableTransactionError(undefined), false);
  });
});
