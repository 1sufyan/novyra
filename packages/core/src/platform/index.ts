import "server-only";

import { getPrisma } from "@novyra/db";

import { checkHealth, type HealthReport } from "../shared/health.ts";

/** Health of this process's database and background work. Apps call this; they never touch the DB. */
export function checkPlatformHealth(): Promise<HealthReport> {
  return checkHealth(getPrisma());
}
