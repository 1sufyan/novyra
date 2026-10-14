import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import { EnvValidationError, parseServerEnv } from "./server.ts";

const valid = {
  APP_ENV: "development",
  DATABASE_URL: "postgresql://novyra:novyra@localhost:5432/novyra",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  ADMIN_URL: "http://localhost:3001",
};

describe("parseServerEnv", () => {
  test("applies defaults in development", () => {
    const env = parseServerEnv(valid);
    expect(env.APP_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  test("requires APP_ENV, so a deployment can't fall back to development", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: undefined })).toThrow(/APP_ENV/);
  });

  test("treats empty strings as unset", () => {
    const env = parseServerEnv({ ...valid, CRON_SECRET: "" });
    expect(env.CRON_SECRET).toBeUndefined();
  });

  test("rejects a non-postgres database URL", () => {
    expect(() => parseServerEnv({ ...valid, DATABASE_URL: "mysql://x@localhost/db" })).toThrow(
      /DATABASE_URL/,
    );
  });

  test("names every problem and never echoes values", () => {
    const leaked = "super-secret-but-too-short";
    try {
      parseServerEnv({ ...valid, DATABASE_URL: undefined, CRON_SECRET: leaked });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).toMatch(/CRON_SECRET must be at least 32 characters/);
      expect(message).not.toContain(leaked);
    }
  });

  test("requires deployment secrets and https in production", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: "production" })).toThrow(EnvValidationError);
    try {
      parseServerEnv({ ...valid, APP_ENV: "production" });
    } catch (error) {
      const problems = (error as EnvValidationError).problems.join("\n");
      expect(problems).toMatch(/DATA_ENCRYPTION_KEY is required when APP_ENV=production/);
      expect(problems).toMatch(/INTERNAL_API_SECRET is required/);
      expect(problems).toMatch(/CRON_SECRET is required/);
      expect(problems).toMatch(/NEXT_PUBLIC_SITE_URL must use https:\/\//);
    }
  });

  test("accepts a complete production configuration", () => {
    const env = parseServerEnv({
      DATABASE_URL: "postgresql://app:pw@db.internal:5432/novyra?sslmode=require",
      NEXT_PUBLIC_SITE_URL: "https://novyra.pk",
      ADMIN_URL: "https://admin.novyra.pk",
      APP_ENV: "production",
      DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      INTERNAL_API_SECRET: "x".repeat(48),
      CRON_SECRET: "y".repeat(48),
    });
    expect(env.APP_ENV).toBe("production");
  });

  test("rejects an encryption key of the wrong length", () => {
    expect(() =>
      parseServerEnv({ ...valid, DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow(/DATA_ENCRYPTION_KEY must be 32 random bytes/);
  });

  test("accepts a key with a trailing newline, and returns it trimmed", () => {
    const key = randomBytes(32).toString("base64");
    expect(parseServerEnv({ ...valid, DATA_ENCRYPTION_KEY: `${key}\n` }).DATA_ENCRYPTION_KEY).toBe(key);
  });

  test("rejects passphrases and placeholders that happen to decode to 32 bytes", () => {
    for (const key of [
      "changeme changeme changeme changeme changeme123",
      "a".repeat(43) + "=",
      Buffer.alloc(32, 7).toString("base64"),
    ]) {
      expect(Buffer.from(key, "base64")).toHaveLength(32);
      expect(() => parseServerEnv({ ...valid, DATA_ENCRYPTION_KEY: key })).toThrow(/DATA_ENCRYPTION_KEY/);
    }
  });
});
