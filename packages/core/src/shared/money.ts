import Decimal from "decimal.js";

/**
 * Exact money arithmetic. Amounts are decimal strings with two fraction digits ("125000.00"),
 * never JS numbers. Rounding is half-up to the currency's minor unit (docs/02-database.md §1).
 */

/** Minor-unit digits per supported currency. */
export const CURRENCIES = { PKR: 2, USD: 2, AED: 2, GBP: 2, EUR: 2 } as const;
export type CurrencyCode = keyof typeof CURRENCIES;

/** The wire shape used by DTOs and integration contracts. */
export interface MoneyJSON {
  readonly amount: string;
  readonly currency: CurrencyCode;
}

/** Anything that renders an exact decimal through toString(), e.g. Prisma.Decimal. */
export interface DecimalLike {
  toString(): string;
}

const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof Dec>;

const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;

export class MoneyError extends Error {
  override name = "MoneyError";
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCIES, value);
}

export class Money {
  readonly #amount: Dec;
  readonly currency: CurrencyCode;

  private constructor(amount: Dec, currency: CurrencyCode) {
    this.#amount = amount;
    this.currency = currency;
  }

  /**
   * Parses an exact amount. Accepts decimal strings and decimal objects (Prisma.Decimal), and rejects
   * JS numbers so that float rounding can never sneak in. More fraction digits than the currency
   * allows is an error, not a silent rounding.
   */
  static of(amount: string | bigint | DecimalLike, currency: CurrencyCode | string): Money {
    if (typeof currency !== "string" || !isCurrencyCode(currency)) {
      throw new MoneyError(`Unsupported currency: ${String(currency)}`);
    }
    if (typeof amount === "number") {
      throw new MoneyError("Money amounts must be decimal strings, not JS numbers");
    }
    const text = typeof amount === "bigint" ? amount.toString() : amount.toString().trim();
    if (!AMOUNT_PATTERN.test(text)) throw new MoneyError(`Not a decimal amount: "${text}"`);
    const value = new Dec(text);
    if (value.decimalPlaces() > CURRENCIES[currency]) {
      throw new MoneyError(`${text} has more than ${CURRENCIES[currency]} fraction digits for ${currency}`);
    }
    return new Money(value, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(new Dec(0), currency);
  }

  static fromJSON(json: MoneyJSON): Money {
    return Money.of(json.amount, json.currency);
  }

  /** Sum of `items` in `currency` (zero for an empty list). */
  static sum(items: readonly Money[], currency: CurrencyCode): Money {
    return items.reduce((total, item) => total.plus(item), Money.zero(currency));
  }

  plus(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#amount.plus(other.#amount), this.currency);
  }

  minus(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#amount.minus(other.#amount), this.currency);
  }

  /** Multiplies by a whole quantity (line totals). */
  times(quantity: number): Money {
    if (!Number.isSafeInteger(quantity)) throw new MoneyError(`Quantity must be an integer, got ${quantity}`);
    return new Money(this.#amount.times(quantity), this.currency);
  }

  /** `percent` of this amount (e.g. "12.5" → 12.5 %), rounded half-up to the minor unit. */
  percentage(percent: string | DecimalLike): Money {
    const rate = new Dec(percent.toString());
    return new Money(this.#round(this.#amount.times(rate).dividedBy(100)), this.currency);
  }

  /**
   * Splits this amount across `weights` in proportion, so the parts always add up exactly
   * (largest-remainder method). Used to spread an order discount over its lines.
   */
  allocate(weights: readonly (Money | string)[]): Money[] {
    if (weights.length === 0) throw new MoneyError("Cannot allocate across zero weights");
    const ws = weights.map((w) => (w instanceof Money ? w.#amount : new Dec(w)));
    if (ws.some((w) => w.isNegative())) throw new MoneyError("Allocation weights must not be negative");
    const total = ws.reduce((sum, w) => sum.plus(w), new Dec(0));
    if (total.isZero()) throw new MoneyError("Allocation weights must not all be zero");

    const unit = new Dec(10).pow(-CURRENCIES[this.currency]);
    const units = this.#amount.dividedBy(unit); // amount in minor units (integer)
    const exact = ws.map((w) => units.times(w).dividedBy(total));
    const floors = exact.map((e) => e.floor());
    let remainder = units.minus(floors.reduce((sum, f) => sum.plus(f), new Dec(0))).toNumber();

    // Hand out the leftover minor units to the largest fractional parts (stable by index).
    const order = exact
      .map((e, index) => ({ index, fraction: e.minus(e.floor()) }))
      .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index);
    const result = [...floors];
    for (const { index } of order) {
      if (remainder <= 0) break;
      result[index] = result[index]!.plus(1);
      remainder--;
    }
    return result.map((u) => new Money(u.times(unit), this.currency));
  }

  isZero(): boolean {
    return this.#amount.isZero();
  }

  isNegative(): boolean {
    return this.#amount.isNegative() && !this.#amount.isZero();
  }

  isPositive(): boolean {
    return this.#amount.isPositive() && !this.#amount.isZero();
  }

  compare(other: Money): -1 | 0 | 1 {
    this.#assertSameCurrency(other);
    return this.#amount.comparedTo(other.#amount) as -1 | 0 | 1;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.#amount.equals(other.#amount);
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  min(other: Money): Money {
    return this.lessThan(other) ? this : other;
  }

  max(other: Money): Money {
    return this.greaterThan(other) ? this : other;
  }

  /** Fixed-point string with exactly the currency's minor digits, e.g. "1250.00". */
  toString(): string {
    return this.#amount.toFixed(CURRENCIES[this.currency]);
  }

  toJSON(): MoneyJSON {
    return { amount: this.toString(), currency: this.currency };
  }

  #round(value: Dec): Dec {
    return value.toDecimalPlaces(CURRENCIES[this.currency], Dec.ROUND_HALF_UP);
  }

  #assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
