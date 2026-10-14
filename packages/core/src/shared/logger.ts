import { pino, stdSerializers, type DestinationStream, type LogFn, type Logger } from "pino";

import { getRequestContext } from "./request-context.ts";

/**
 * Logs never carry secrets or personal data (docs/01-architecture.md §7, docs/03-security.md §14).
 * Every logged object, binding and message argument is walked (arrays and errors included; content
 * nested deeper than MAX_DEPTH is replaced), and:
 *  - a value whose key names a secret or personal field (case and separators ignored) is replaced;
 *  - email addresses and card numbers are masked inside strings, messages included, and card
 *    numbers held as plain numbers are replaced.
 * Logging stays a deliberate act: put data in the object argument and keep messages generic.
 */

const CENSOR = "[redacted]";
const MAX_DEPTH = 10;

/** Short words that are sensitive as a whole word of the key (otpCode, card_cvc, cvv2, walletPin). */
const SENSITIVE_WORDS = new Set(["otp", "pin", "mpin", "pan", "cvv", "cvc", "cvn", "cnic", "ssn"]);
/** A key containing one of these, ignoring case and separators, is sensitive (x-api-key, Set-Cookie…). */
const SENSITIVE_PARTS = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "email",
  "phone",
  "mobile",
  "msisdn",
  "whatsapp",
  "contactnumber",
  "iban",
  "accountnumber",
  "cardnumber",
  "creditcard",
];

/** accountNo, card_num, cnicNo: a holder word followed by a number word. */
const NUMBER_HOLDERS = new Set(["account", "acct", "acc", "card", "cnic"]);
const NUMBER_WORDS = new Set(["no", "num", "nbr", "number"]);
/** Keys written without any word boundary (otpcode, OTPCODE, walletpin). */
const UNBROKEN_PREFIX = /^(otp|cvv|cvc|cnic)/;
const UNBROKEN_SUFFIX = /(otp|pin|cvv|cvc|accountno|acctno|cardno)$/;

export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SENSITIVE_PARTS.some((part) => normalised.includes(part))) return true;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // otpCode → otp Code
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // OTPCode → OTP Code
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (words.some((word) => SENSITIVE_WORDS.has(word))) return true;
  for (let i = 0; i + 1 < words.length; i++) {
    if (NUMBER_HOLDERS.has(words[i]!) && NUMBER_WORDS.has(words[i + 1]!)) return true;
  }
  return UNBROKEN_PREFIX.test(normalised) || UNBROKEN_SUFFIX.test(normalised);
}

// Every quantifier is bounded, so the work per start position is constant and masking stays linear
// in the length of the text (unbounded `+` here backtracks quadratically on long runs without "@").
const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,8}\.[a-z]{2,24}/gi;
/** 13–19 digits, optionally grouped by spaces or dashes: candidates for isCardLike. */
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

/**
 * A card number: 14–19 digits starting with 2–6 (the major networks) that pass Luhn. That shape
 * leaves out epoch-millisecond timestamps (13 digits) and epoch microseconds (starting with 1).
 */
function isCardLike(digits: string): boolean {
  return /^[2-6]\d{13,18}$/.test(digits) && passesLuhn(digits);
}

/** Masks email addresses and card numbers (Luhn-valid digit runs) inside free text. */
export function maskText(text: string): string {
  return text
    .replace(EMAIL, CENSOR)
    .replace(CARD_LIKE, (match) => (isCardLike(match.replace(/[ -]/g, "")) ? CENSOR : match));
}

function scrub(value: unknown, depth: number, ancestors: object[]): unknown {
  if (typeof value === "string") return maskText(value);
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && isCardLike(String(Math.abs(value))) ? CENSOR : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (ancestors.includes(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";

  const next = [...ancestors, value];
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1, next));
  // Errors are serialized first, so their message, stack, cause and extra fields are scrubbed too.
  // Objects with their own JSON form (Date, URL, Money, Decimal…) are scrubbed in that form.
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  let source: unknown = value;
  try {
    if (value instanceof Error) source = stdSerializers.errWithCause(value);
    else if (typeof toJSON === "function") source = (toJSON as () => unknown).call(value);
  } catch {
    return "[unserializable]";
  }
  if (source !== value) return scrub(source, depth + 1, next);

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    // Keys can carry data too (a map keyed by email address). defineProperty keeps a "__proto__"
    // key as an ordinary property instead of changing the copy's prototype.
    // Masked keys stay distinct, so entries never overwrite each other.
    let name = maskText(key);
    for (let n = 2; Object.hasOwn(result, name); n++) name = `${maskText(key)}#${n}`;
    Object.defineProperty(result, name, {
      value: isSensitiveKey(key) ? CENSOR : scrub(item, depth + 1, next),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

/** A printf-style value: an Error reads as "Name: message" (as with %s), everything else is scrubbed. */
function scrubArgument(value: unknown): unknown {
  return value instanceof Error ? maskText(String(value)) : redactForLog(value);
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
      // The merging object is scrubbed by formatters.log; here the message and every interpolation
      // value (%s, %d, %j, %o…) are scrubbed before pino formats them.
      logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn) {
        if (args.length === 0) return method.apply(this, args);
        const [first, ...rest] = args as unknown[];
        const call = (final: unknown[]) => method.apply(this, final as Parameters<LogFn>);
        if (typeof first === "string") return call([maskText(first), ...rest.map(scrubArgument)]);

        const object = first instanceof Error ? { err: first } : first;
        const [message, ...values] = rest;
        if (typeof message === "string")
          return call([object, maskText(message), ...values.map(scrubArgument)]);
        // pino falls back to the error's own message, which would skip masking: supply it masked.
        const err =
          typeof object === "object" && object !== null ? (object as { err?: unknown }).err : undefined;
        const fallback = err instanceof Error ? [maskText(err.message)] : [];
        return call([object, ...fallback, ...rest.map(scrubArgument)]);
      },
    },
    // Attach the request id, when there is one, to every line.
    mixin() {
      const context = getRequestContext();
      return context ? { requestId: context.requestId } : {};
    },
  };
  const logger = options.destination ? pino(config, options.destination) : pino(config);
  // pino applies no formatter to child bindings, so redact them here. Children inherit both methods.
  const child = logger.child;
  logger.child = function (this: Logger, bindings, childOptions) {
    return child.call(this, redactForLog(bindings), childOptions);
  } as Logger["child"];
  const setBindings = logger.setBindings;
  logger.setBindings = function (this: Logger, bindings) {
    setBindings.call(this, redactForLog(bindings));
  } as Logger["setBindings"];
  return logger;
}
