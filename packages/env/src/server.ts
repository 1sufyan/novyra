import "server-only";

import { parseServerEnv, type ServerEnv } from "./schema.ts";

export * from "./schema.ts";

let cached: ServerEnv | undefined;

/** Validated server environment, parsed from process.env on first use. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
