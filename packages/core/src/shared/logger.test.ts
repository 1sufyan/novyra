import { Writable } from "node:stream";

import { describe, expect, test } from "vitest";

import { createLogger } from "./logger.ts";
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
    const text = JSON.stringify(lines[0]);
    for (const leaked of [
      "hunter2",
      "ayesha@example.com",
      "+923001234567",
      "PK36SCBL",
      "Bearer abc",
      "session=xyz",
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(text).toContain("Ayesha");
    expect(lines[0]).toMatchObject({ service: "test", msg: "checkout" });
  });

  test("adds the request id from the current context", () => {
    const { lines, logger } = capture();
    runWithContext({ requestId: "req-123" }, () => logger.info("inside"));
    logger.info("outside");
    expect(lines[0]).toMatchObject({ requestId: "req-123", msg: "inside" });
    expect(lines[1]).not.toHaveProperty("requestId");
  });
});
