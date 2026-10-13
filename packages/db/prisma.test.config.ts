import "./load-env.ts";

import { defineConfig, env } from "prisma/config";

// Same schema and migrations as prisma.config.ts, pointed at the disposable integration-test database.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("TEST_DATABASE_URL"),
  },
});
