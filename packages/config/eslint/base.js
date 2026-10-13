// Shared ESLint flat config for every NOVYRA package.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export const IGNORES = [
  "**/node_modules/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/dist/**",
  "**/coverage/**",
  "**/src/generated/**",
  "**/next-env.d.ts",
];

/** Rules every package shares. See docs/03-security.md §9 and docs/07-folder-structure.md. */
export const sharedRules = {
  eqeqeq: ["error", "smart"],
  "no-console": ["error", { allow: ["warn", "error"] }],
  "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "no-restricted-properties": [
    "error",
    {
      property: "$queryRawUnsafe",
      message: "Use the parameterised tagged template $queryRaw`...` (docs/03-security.md §9).",
    },
    {
      property: "$executeRawUnsafe",
      message: "Use the parameterised tagged template $executeRaw`...` (docs/03-security.md §9).",
    },
  ],
};

export default defineConfig([
  { ignores: IGNORES },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: sharedRules,
  },
  {
    // Scripts and tests may print.
    files: ["**/scripts/**", "**/*.test.ts"],
    rules: { "no-console": "off" },
  },
]);
