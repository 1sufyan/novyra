import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(import.meta.resolve("@novyra/config/vitest/server-only-stub")),
    },
  },
});
