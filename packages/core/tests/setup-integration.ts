import path from "node:path";

import { config } from "dotenv";

// Same precedence as packages/db/load-env.ts: shell > packages/core/.env > root .env.
config({
  path: [path.join(import.meta.dirname, "../.env"), path.join(import.meta.dirname, "../../../.env")],
  quiet: true,
});

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must point to a disposable database with migrations applied.");
}
