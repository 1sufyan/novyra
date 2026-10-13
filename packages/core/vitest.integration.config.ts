import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Integration tests: run against TEST_DATABASE_URL (a disposable database with migrations applied).
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(import.meta.resolve("@novyra/config/vitest/server-only-stub")),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts", "tests/**/*.integration.test.ts"],
    setupFiles: ["./tests/setup-integration.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
