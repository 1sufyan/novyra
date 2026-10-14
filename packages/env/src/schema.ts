import { z } from "zod";

/**
 * Server-side environment schema. Values are never echoed in errors. This module holds no values
 * and doesn't import server-only, so the `check-env` bin can run it before `next dev/build/start`;
 * app code reads the validated values through `@novyra/env/server`.
 * Integration-specific variables (gateways, couriers, email…) are validated by each adapter's own
 * config schema, so a disabled integration never blocks boot. Full list: docs/09-environment.md.
 */

const SECRET_MIN_LENGTH = 32;

const secret = z.string().min(SECRET_MIN_LENGTH, `must be at least ${SECRET_MIN_LENGTH} characters`);

/**
 * Canonical base64 of 32 bytes. Node's decoder skips invalid characters, so a passphrase could
 * decode to 32 bytes; the round trip rejects it, and the byte-variety check rejects placeholders
 * such as "AAAA…" that random bytes essentially never resemble.
 */
const encryptionKey = z.string().refine((value) => {
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value && new Set(key).size >= 16;
}, "must be 32 random bytes, base64-encoded (openssl rand -base64 32)");

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: "must be a postgres:// or postgresql:// URL",
});

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Variables that must be set outside development and test. */
const REQUIRED_WHEN_DEPLOYED = ["DATA_ENCRYPTION_KEY", "INTERNAL_API_SECRET", "CRON_SECRET"] as const;

export const serverEnvSchema = z
  .object({
    // No default: a deployment that forgets it must not silently run as "development".
    APP_ENV: z.enum(APP_ENVS),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: postgresUrl,
    NEXT_PUBLIC_SITE_URL: z.url(),
    ADMIN_URL: z.url(),
    DATA_ENCRYPTION_KEY: encryptionKey.optional(),
    INTERNAL_API_SECRET: secret.optional(),
    CRON_SECRET: secret.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== "staging" && env.APP_ENV !== "production") return;
    for (const key of REQUIRED_WHEN_DEPLOYED) {
      if (!env[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: `is required when APP_ENV=${env.APP_ENV}` });
      }
    }
    for (const key of ["NEXT_PUBLIC_SITE_URL", "ADMIN_URL"] as const) {
      if (!env[key].startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `must use https:// when APP_ENV=${env.APP_ENV}`,
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

/** Parses `source` without caching. Error messages name the variable, never its value. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Treat empty strings (common in .env templates) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = serverEnvSchema.safeParse(cleaned);
  if (result.success) return result.data;
  throw new EnvValidationError(
    result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`),
  );
}
