import { describe, expect, test } from "vitest";

import {
  AppError,
  IntegrationNotConfiguredError,
  NotFoundError,
  ValidationError,
  toPublicError,
} from "./errors.ts";

describe("toPublicError", () => {
  test("hides unknown errors behind a generic message", () => {
    const leaked = new Error('relation "users" violates constraint xyz at 10.0.0.5');
    expect(toPublicError(leaked)).toEqual({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  });

  test("passes through user-safe errors with their status", () => {
    expect(toPublicError(new NotFoundError("Order not found"))).toEqual({
      code: "not_found",
      status: 404,
      message: "Order not found",
    });
  });

  test("includes field errors for validation failures", () => {
    const result = toPublicError(new ValidationError("Check the form", { phone: ["Invalid phone number"] }));
    expect(result.status).toBe(422);
    expect(result.fieldErrors).toEqual({ phone: ["Invalid phone number"] });
  });

  test("keeps internal details of non-exposed AppErrors out", () => {
    const error = new IntegrationNotConfiguredError("jazzcash", ["JAZZCASH_INTEGRITY_SALT"]);
    const result = toPublicError(error);
    expect(result.status).toBe(503);
    expect(result.message).not.toContain("JAZZCASH");
  });

  test("AppError keeps its subclass name and cause", () => {
    const cause = new Error("root");
    const error = new AppError("conflict", "x", { cause });
    expect(error.name).toBe("AppError");
    expect(error.cause).toBe(cause);
    expect(new NotFoundError().name).toBe("NotFoundError");
  });
});
