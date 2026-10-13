/**
 * Typed application errors. Services throw these; the HTTP / Server Action layer turns them into
 * `PublicError` with toPublicError(), so stack traces, SQL and provider messages never reach a client
 * (docs/01-architecture.md §4.2).
 */

export type ErrorCode =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "idempotency_conflict"
  | "rate_limited"
  | "integration_not_configured"
  | "webhook_verification_failed"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 409,
  rate_limited: 429,
  integration_not_configured: 503,
  webhook_verification_failed: 401,
  internal: 500,
};

export interface AppErrorOptions {
  /** True when `message` is safe to show to the end user. */
  expose?: boolean;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = STATUS[code];
    this.expose = options.expose ?? false;
  }
}

export class ValidationError extends AppError {
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;

  constructor(message: string, fieldErrors: Readonly<Record<string, readonly string[]>> = {}) {
    super("validation_failed", message, { expose: true });
    this.fieldErrors = fieldErrors;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("not_found", message, { expose: true });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super("forbidden", message, { expose: true });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Please sign in.") {
    super("unauthenticated", message, { expose: true });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("conflict", message, { expose: true, ...options });
  }
}

export class IntegrationNotConfiguredError extends AppError {
  readonly integration: string;
  readonly missing: readonly string[];

  constructor(integration: string, missing: readonly string[]) {
    // The message names env variables, so it is for logs only.
    super("integration_not_configured", `${integration} is not configured (missing: ${missing.join(", ")})`);
    this.integration = integration;
    this.missing = missing;
  }
}

export class WebhookVerificationError extends AppError {
  constructor(message = "Webhook signature verification failed", options: AppErrorOptions = {}) {
    super("webhook_verification_failed", message, options);
  }
}

/** What a client may see. */
export interface PublicError {
  readonly code: ErrorCode;
  readonly status: number;
  readonly message: string;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export function toPublicError(error: unknown): PublicError {
  if (!(error instanceof AppError)) {
    return { code: "internal", status: 500, message: GENERIC_MESSAGE };
  }
  const base = {
    code: error.code,
    status: error.status,
    message: error.expose ? error.message : GENERIC_MESSAGE,
  };
  return error instanceof ValidationError ? { ...base, fieldErrors: error.fieldErrors } : base;
}
