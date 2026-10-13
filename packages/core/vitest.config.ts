import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests: pure, no database.
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(import.meta.resolve("@novyra/config/vitest/server-only-stub")),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
  },
});
