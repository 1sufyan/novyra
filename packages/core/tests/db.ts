import { createPrismaClient } from "@novyra/db";

/** Client for the disposable integration-test database (see tests/setup-integration.ts). */
export function testPrisma() {
  return createPrismaClient(process.env.TEST_DATABASE_URL!, { maxConnections: 10 });
}
