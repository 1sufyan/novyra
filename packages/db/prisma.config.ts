import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 reads connection strings from here, not from schema.prisma.
// DIRECT_DATABASE_URL bypasses the pooler: migrations need a session-level connection.
// SHADOW_DATABASE_URL is only needed for `migrate dev` / `migrate diff --from-migrations` (dev + CI).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_DATABASE_URL"),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
