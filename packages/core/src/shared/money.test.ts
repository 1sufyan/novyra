import { describe, expect, test } from "vitest";

import { Money, MoneyError } from "./money.ts";

const pkr = (amount: string) => Money.of(amount, "PKR");

describe("Money", () => {
  test("parses decimal strings and decimal-like objects, formats with two digits", () => {
    expect(pkr("1250").toString()).toBe("1250.00");
    expect(pkr("0.5").toString()).toBe("0.50");
    expect(Money.of({ toString: () => "99.90" }, "PKR").toString()).toBe("99.90");
    expect(Money.of(15n, "PKR").toString()).toBe("15.00");
  });

  test("rejects floats, malformed input, excess precision and unknown currencies", () => {
    expect(() => Money.of(0.1 as unknown as string, "PKR")).toThrow(MoneyError);
    expect(() => pkr("1e3")).toThrow(MoneyError);
    expect(() => pkr("12.345")).toThrow(/fraction digits/);
    expect(() => pkr("")).toThrow(MoneyError);
    expect(() => Money.of("1", "XYZ")).toThrow(/Unsupported currency/);
  });

  test("arithmetic is exact where floats are not", () => {
    expect(pkr("0.10").plus(pkr("0.20")).toString()).toBe("0.30");
    expect(pkr("100000000000.01").plus(pkr("0.02")).toString()).toBe("100000000000.03");
    expect(pkr("19.99").times(3).toString()).toBe("59.97");
    expect(pkr("10").minus(pkr("12.5")).toString()).toBe("-2.50");
  });

  test("refuses to mix currencies", () => {
    expect(() => pkr("1").plus(Money.of("1", "USD"))).toThrow(/Currency mismatch/);
    expect(() => pkr("1").compare(Money.of("1", "USD"))).toThrow(/Currency mismatch/);
  });

  test("percentage rounds half-up to the minor unit", () => {
    expect(pkr("100").percentage("12.5").toString()).toBe("12.50");
    expect(pkr("0.05").percentage("50").toString()).toBe("0.03"); // 0.025 → 0.03
    expect(pkr("33.33").percentage("10").toString()).toBe("3.33"); // 3.333 → 3.33
  });

  test("allocate splits exactly, giving leftover units to the largest remainders", () => {
    const parts = pkr("100").allocate(["1", "1", "1"]);
    expect(parts.map(String)).toEqual(["33.34", "33.33", "33.33"]);
    expect(Money.sum(parts, "PKR").toString()).toBe("100.00");

    const discount = pkr("1000").allocate([pkr("2500"), pkr("7500")]);
    expect(discount.map(String)).toEqual(["250.00", "750.00"]);

    const uneven = pkr("0.05").allocate(["1", "1", "1"]);
    expect(Money.sum(uneven, "PKR").toString()).toBe("0.05");
  });

  test("allocate rejects degenerate weights", () => {
    expect(() => pkr("1").allocate([])).toThrow(MoneyError);
    expect(() => pkr("1").allocate(["0", "0"])).toThrow(/all be zero/);
    expect(() => pkr("1").allocate(["-1", "2"])).toThrow(/negative/);
  });

  test("comparisons and JSON round-trip", () => {
    expect(pkr("5").greaterThan(pkr("4.99"))).toBe(true);
    expect(pkr("5").min(pkr("7")).toString()).toBe("5.00");
    expect(pkr("0").isZero()).toBe(true);
    expect(pkr("-1").isNegative()).toBe(true);
    expect(JSON.stringify({ total: pkr("12") })).toBe('{"total":{"amount":"12.00","currency":"PKR"}}');
    expect(Money.fromJSON({ amount: "12.00", currency: "PKR" }).equals(pkr("12"))).toBe(true);
  });
});
