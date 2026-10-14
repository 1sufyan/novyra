import { Writable } from "node:stream";

import { describe, expect, test } from "vitest";

import { createLogger, isSensitiveKey, maskText } from "./logger.ts";
import { runWithContext } from "./request-context.ts";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return { lines, logger: createLogger("test", { destination, level: "info" }) };
}

const LEAKS = [
  "hunter2",
  "ayesha@example.com",
  "b@example.com",
  "+923001234567",
  "PK36SCBL",
  "Bearer abc",
  "Bearer LEAK2",
  "LEAK3",
  "session=xyz",
  "better-auth.session_token",
  "4111 1111 1111 1111",
  "4111111111111111",
];

function expectClean(line: unknown) {
  const text = JSON.stringify(line);
  for (const leaked of LEAKS) expect(text).not.toContain(leaked);
}

describe("logger", () => {
  test("redacts secrets and personal data, top-level and nested", () => {
    const { lines, logger } = capture();
    logger.info(
      {
        password: "hunter2",
        email: "ayesha@example.com",
        customer: { phone: "+923001234567", iban: "PK36SCBL0000001123456702", name: "Ayesha" },
        headers: { authorization: "Bearer abc", cookie: "session=xyz" },
      },
      "checkout",
    );
    expectClean(lines[0]);
    expect(JSON.stringify(lines[0])).toContain("Ayesha");
    expect(lines[0]).toMatchObject({ service: "test", msg: "checkout" });
  });

  test("redacts at any depth, inside arrays, and regardless of key case", () => {
    const { lines, logger } = capture();
    logger.warn(
      {
        order: { shippingAddress: { phone: "+923001234567", email: "ayesha@example.com", city: "Lahore" } },
        request: { headers: { Authorization: "Bearer LEAK2", "x-api-key": "LEAK3" } },
        recipients: [{ email: "b@example.com" }],
        refund: { payoutDetails: { iban: "PK36SCBL0000001123456702" } },
        req: { headers: { cookie: "better-auth.session_token=LEAK4" } },
        response: { headers: { "Set-Cookie": "session=xyz" } },
      },
      "outbound call",
    );
    expectClean(lines[0]);
    expect(JSON.stringify(lines[0])).toContain("Lahore");
  });

  test("masks emails and card numbers in messages, strings and errors", () => {
    const { lines, logger } = capture();
    const error = Object.assign(new Error("Key (email)=(ayesha@example.com) already exists"), {
      detail: "card 4111 1111 1111 1111 declined",
    });
    logger.error({ err: error, note: "paid with 4111111111111111" }, "failed for ayesha@example.com");
    expectClean(lines[0]);
    expect(lines[0]).toMatchObject({ err: { type: "Error" } });
    expect(JSON.stringify(lines[0])).toContain("already exists");
  });

  test("serializes an error passed as the first argument", () => {
    const { lines, logger } = capture();
    logger.error(new Error("lookup failed for ayesha@example.com"));
    expectClean(lines[0]);
    expect(lines[0]).toMatchObject({
      err: { type: "Error", message: "lookup failed for [redacted]" },
      msg: "lookup failed for [redacted]",
    });
    logger.error({ err: new Error("no user ayesha@example.com") });
    expectClean(lines[1]);
    expect(lines[1]).toMatchObject({ msg: "no user [redacted]" });
  });

  test("redacts child logger bindings", () => {
    const { lines, logger } = capture();
    logger.child({ email: "ayesha@example.com", orderId: "o-1" }).info("placed");
    expectClean(lines[0]);
    expect(lines[0]).toMatchObject({ orderId: "o-1" });
  });

  test("leaves ordinary numbers and identifiers alone, and survives cycles", () => {
    expect(maskText("order NVY-2026-000123, total 125000.00")).toBe("order NVY-2026-000123, total 125000.00");
    expect(maskText("4111111111111112")).toBe("4111111111111112");
    expect(maskText("at /node_modules/.pnpm/vitest@5.0.4_jiti@2.7.0_tsx@4.23.15/x.js")).not.toContain(
      "[redacted]",
    );
    expect(isSensitiveKey("orderId")).toBe(false);
    const { lines, logger } = capture();
    const loop: Record<string, unknown> = { name: "loop" };
    loop.self = loop;
    logger.info({ loop }, "cycle");
    expect(lines[0]).toMatchObject({ loop: { name: "loop", self: "[circular]" } });
  });

  test("adds the request id from the current context", () => {
    const { lines, logger } = capture();
    runWithContext({ requestId: "req-123" }, () => logger.info("inside"));
    logger.info("outside");
    expect(lines[0]).toMatchObject({ requestId: "req-123", msg: "inside" });
    expect(lines[1]).not.toHaveProperty("requestId");
  });
});
