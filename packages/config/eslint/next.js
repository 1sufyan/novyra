// ESLint flat config for the Next.js apps (storefront, admin).
import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

import { IGNORES, sharedRules } from "./base.js";

export default defineConfig([
  { ignores: IGNORES },
  nextCoreWebVitals,
  nextTypescript,
  {
    rules: {
      ...sharedRules,
      // Apps reach data only through @novyra/core, which returns DTOs (docs/01-architecture.md §2).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@novyra/db", "@novyra/db/*"],
              message: "Apps must not import @novyra/db. Go through @novyra/core, which returns DTOs.",
            },
            {
              group: ["@novyra/*/src/*"],
              message: "Import a package through its public entry point, not its src/ files.",
            },
          ],
        },
      ],
      // Raw HTML only through a sanitising component, added in Phase 2 (docs/03-security.md §8).
      "react/no-danger": "error",
    },
  },
]);
