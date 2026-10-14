import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { serverEnvSchema } from "./schema.ts";

/**
 * Every variable check-env validates must be part of the build task's cache key, or a build replayed
 * from the turbo cache would skip check-env after that variable changed (docs/09-environment.md).
 */
describe("turbo.json", () => {
  test("the build task hashes every validated server variable", () => {
    const turbo = JSON.parse(readFileSync(new URL("../../../turbo.json", import.meta.url), "utf8")) as {
      tasks: { build: { env: string[] } };
    };
    const hashed = turbo.tasks.build.env;
    const covered = (key: string) =>
      hashed.includes(key) || (key.startsWith("NEXT_PUBLIC_") && hashed.includes("NEXT_PUBLIC_*"));
    const missing = Object.keys(serverEnvSchema.shape).filter((key) => !covered(key));
    expect(missing).toEqual([]);
  });
});
