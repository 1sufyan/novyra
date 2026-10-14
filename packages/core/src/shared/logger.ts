import { pino, stdSerializers, type DestinationStream, type LogFn, type Logger } from "pino";

import { getRequestContext } from "./request-context.ts";

/**
 * Logs never carry secrets or personal data (docs/01-architecture.md §7, docs/03-security.md §14).
 * Every logged object is walked to any depth, arrays and errors included, and:
 *  - a value whose key names a secret or personal field (case and separators ignored) is replaced;
 *  - email addresses and card-like numbers inside strings are masked, in messages too.
 * Logging stays a deliberate act: put data in the object argument and keep messages generic.
 */

const CENSOR = "[redacted]";
const MAX_DEPTH = 10;

/** Normalised keys that are always sensitive. */
const SENSITIVE_KEYS = new Set(["otp", "pin", "pan", "cvv", "cvc"]);
/** A normalised key containing one of these is sensitive (accessToken, x-api-key, Set-Cookie…). */
const SENSITIVE_PARTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "email",
  "phone",
  "iban",
  "cardnumber",
];

export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEYS.has(normalised) || SENSITIVE_PARTS.some((part) => normalised.includes(part));
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
/** 13–19 digits, optionally grouped by spaces or dashes: the shape of a card number. */
const CARD_LIKE = /\b\d(?:[ -]?\d){12,18}\b/g;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Masks email addresses and card numbers (Luhn-valid digit runs) inside free text. */
export function maskText(text: string): string {
  return text
    .replace(EMAIL, CENSOR)
    .replace(CARD_LIKE, (match) => (passesLuhn(match.replace(/[ -]/g, "")) ? CENSOR : match));
}

function scrub(value: unknown, depth: number, ancestors: object[]): unknown {
  if (typeof value === "string") return maskText(value);
  if (value === null || typeof value !== "object") return value;
  if (ancestors.includes(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";

  const next = [...ancestors, value];
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1, next));
  // Errors are serialized first, so their message, stack, cause and extra fields are scrubbed too.
  // Objects with their own JSON form (Date, URL, Money, Decimal…) are scrubbed in that form.
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  const source: unknown =
    value instanceof Error
      ? stdSerializers.errWithCause(value)
      : typeof toJSON === "function"
        ? (toJSON as () => unknown).call(value)
        : value;
  if (source !== value) return scrub(source, depth + 1, next);

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? CENSOR : scrub(item, depth + 1, next);
  }
  return result;
}

/** Returns a copy of `value` that is safe to log. */
export function redactForLog<T>(value: T): T {
  return scrub(value, 0, []) as T;
}

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
    formatters: {
      log: (object: Record<string, unknown>) => redactForLog(object),
    },
    // Errors are already serialized (and scrubbed) by the log formatter.
    serializers: { err: (value: unknown) => value },
    hooks: {
      logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn) {
        const [first, ...rest] = args as unknown[];
        const object = first instanceof Error ? { err: first } : first;
        const strings = typeof first === "string" ? [first, ...rest] : rest;
        // pino falls back to the error's own message, which would skip masking: supply it masked.
        const err =
          typeof object === "object" && object !== null ? (object as { err?: unknown }).err : undefined;
        if (typeof strings[0] !== "string" && err instanceof Error) strings.unshift(err.message);
        const masked = strings.map((arg) => (typeof arg === "string" ? maskText(arg) : arg));
        const final = typeof first === "string" ? masked : [object, ...masked];
        method.apply(this, final as Parameters<LogFn>);
      },
    },
    // Attach the request id, when there is one, to every line.
    mixin() {
      const context = getRequestContext();
      return context ? { requestId: context.requestId } : {};
    },
  };
  const logger = options.destination ? pino(config, options.destination) : pino(config);
  // pino applies no formatter to child bindings, so redact them here. Children inherit this method.
  const child = logger.child;
  logger.child = function (this: Logger, bindings, childOptions) {
    return child.call(this, redactForLog(bindings), childOptions);
  } as Logger["child"];
  return logger;
}
