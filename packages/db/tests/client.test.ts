/**
 * createPrismaClient() against a database that stops answering: queries fail instead of hanging.
 *
 *   pnpm db:test      (TEST_DATABASE_URL from the root .env or the shell)
 */
import assert from "node:assert/strict";
import { createServer, connect, type Socket } from "node:net";
import { after, describe, test } from "node:test";

import "../load-env.ts";
import { createPrismaClient } from "../src/client.ts";
import { withTransaction } from "../src/transaction.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL must point to a disposable database with migrations applied.");
}
const target = new URL(url);

/** A TCP proxy to the test database that can be switched to swallow all traffic in both directions. */
async function silenceableProxy() {
  let silent = false;
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = connect(Number(target.port || 5432), target.hostname);
    sockets.add(client).add(upstream);
    client.on("data", (chunk) => void (silent || upstream.write(chunk)));
    upstream.on("data", (chunk) => void (silent || client.write(chunk)));
    for (const socket of [client, upstream]) socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const proxied = new URL(url!);
  proxied.hostname = "127.0.0.1";
  proxied.port = String(port);
  return {
    url: proxied.toString(),
    silence: () => void (silent = true),
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

describe("createPrismaClient after a query timeout", () => {
  test("a transaction cut off by the query timeout is rolled back, not left open on a pooled connection", async () => {
    const admin = createPrismaClient(url!);
    const app = createPrismaClient(url!, { maxConnections: 1, queryTimeoutMs: 500 });
    try {
      await admin.$executeRaw`DROP TABLE IF EXISTS client_timeout_probe`;
      await admin.$executeRaw`CREATE TABLE client_timeout_probe (id int PRIMARY KEY, note text NOT NULL)`;
      await admin.$executeRaw`INSERT INTO client_timeout_probe VALUES (0, 'original')`;

      // Another session holds row 0 long past the transaction timeout plus the query timeout.
      const locker = admin.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM client_timeout_probe WHERE id = 0 FOR UPDATE`;
          await new Promise((resolve) => setTimeout(resolve, 2_500));
        },
        { timeout: 10_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      await assert.rejects(
        withTransaction(
          app,
          async (tx) => {
            await tx.$executeRaw`INSERT INTO client_timeout_probe VALUES (1, 'from the failed transaction')`;
            await tx.$executeRaw`UPDATE client_timeout_probe SET note = 'updated by the failed transaction' WHERE id = 0`;
          },
          { timeoutMs: 300, maxRetries: 0 },
        ),
      );
      await locker;

      // The next autocommit write must be visible to everyone at once, i.e. not run inside the
      // abandoned transaction, and nothing from that transaction may ever appear.
      await app.$executeRaw`INSERT INTO client_timeout_probe VALUES (2, 'autocommit')`;
      const rows = await admin.$queryRaw<{ id: number; note: string }[]>`
        SELECT id, note FROM client_timeout_probe ORDER BY id`;
      assert.deepEqual(rows, [
        { id: 0, note: "original" },
        { id: 2, note: "autocommit" },
      ]);
    } finally {
      await app.$disconnect();
      await admin.$executeRaw`DROP TABLE IF EXISTS client_timeout_probe`;
      await admin.$disconnect();
    }
  });
});

describe("createPrismaClient", () => {
  const cleanups: (() => unknown)[] = [];
  after(async () => {
    for (const cleanup of cleanups) await cleanup();
  });

  test("a query on an open connection to a database that went silent fails within queryTimeoutMs", async () => {
    const proxy = await silenceableProxy();
    const prisma = createPrismaClient(proxy.url, { maxConnections: 1, queryTimeoutMs: 500 });
    cleanups.push(() => prisma.$disconnect().catch(() => undefined), proxy.close);

    await prisma.$queryRaw`SELECT 1`; // the pooled connection is now open
    proxy.silence();
    const started = Date.now();
    await assert.rejects(prisma.$queryRaw`SELECT 1`);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3_000, `failed after ${elapsed} ms`);
  });
});
