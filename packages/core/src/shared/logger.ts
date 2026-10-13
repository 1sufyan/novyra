import { pino, type DestinationStream, type Logger } from "pino";

import { getRequestContext } from "./request-context.ts";

/**
 * Paths whose values never reach logs (docs/01-architecture.md §7). Wildcards cover one level of
 * nesting, so nested objects with these keys are redacted too.
 */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "headers.authorization",
  "headers.cookie",
  "cookie",
  "*.cookie",
  "email",
  "*.email",
  "phone",
  "*.phone",
  "iban",
  "*.iban",
  "cardNumber",
  "*.cardNumber",
  "cvv",
  "*.cvv",
];

export interface CreateLoggerOptions {
  level?: string;
  /** Test hook: write somewhere other than stdout. */
  destination?: DestinationStream;
}

/** JSON logger for one service ("storefront", "admin", "jobs", …) with redaction applied. */
export function createLogger(service: string, options: CreateLoggerOptions = {}): Logger {
  const config = {
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    base: { service },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    // Attach the request id, when there is one, to every line.
    mixin() {
      const context = getRequestContext();
      return context ? { requestId: context.requestId } : {};
    },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
