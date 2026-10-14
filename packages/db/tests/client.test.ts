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
