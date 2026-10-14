import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.ts";

export interface CreatePrismaClientOptions {
  /** Maximum pooled connections for this process (default 10). Keep it low behind a pooler. */
  maxConnections?: number;
  /**
   * Give up opening a connection, or waiting for a free one, after this long (default 5 s).
   * node-postgres otherwise waits forever.
   */
  connectionTimeoutMs?: number;
  /**
   * Fail a query that gets no answer within this long (default 30 s), for example on a pooled
   * connection that went silent during a failover. Interactive transactions also have their own,
   * shorter timeout (withTransaction).
   */
  queryTimeoutMs?: number;
}

/** Creates a client over node-postgres. Prefer `getPrisma()` in application code. */
export function createPrismaClient(connectionString: string, options: CreatePrismaClientOptions = {}) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: options.maxConnections ?? 10,
      connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
      query_timeout: options.queryTimeoutMs ?? 30_000,
      // TCP keep-alive lets the OS notice a peer that vanished without closing the connection.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      idleTimeoutMillis: 30_000,
    }),
  });
}

// One client per process. In development the module is re-evaluated on every hot reload,
// so the instance is kept on globalThis to avoid opening a new pool each time.
const globalForPrisma = globalThis as typeof globalThis & { __novyraPrisma?: PrismaClient };

/** Process-wide client for DATABASE_URL (the pooled runtime connection). */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__novyraPrisma) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see docs/09-environment.md).");
    globalForPrisma.__novyraPrisma = createPrismaClient(url);
  }
  return globalForPrisma.__novyraPrisma;
}
