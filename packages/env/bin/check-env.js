#!/usr/bin/env node
// Validates the server environment and exits 1, naming each problem, when it is invalid. App scripts
// run it before `next dev`, `next build` and `next start`, so a misconfigured deploy fails instead of
// going live and answering 500 (docs/09-environment.md). Values are never printed.
import { EnvValidationError, parseServerEnv } from "../src/schema.ts";

try {
  parseServerEnv(process.env);
} catch (error) {
  if (!(error instanceof EnvValidationError)) throw error;
  console.error(error.message);
  process.exit(1);
}
