/**
 * Database integrity tests.
 *
 * Proves that the invariants the services rely on hold at the database level,
 * including under concurrency. Run against a DISPOSABLE database with all
 * migrations applied:
 *
 *   pnpm db:test:prepare && pnpm db:test      (TEST_DATABASE_URL from the root .env or the shell)
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import "../load-env.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL must point to a disposable database with migrations applied.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
after(() => prisma.$disconnect());

const suffix = () => randomUUID().slice(0, 8);

/** Asserts that `action` fails because of the named constraint / index / trigger. */
async function rejectsWith(action: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(action, (error: unknown) => {
    const detail = error instanceof Error ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}` : String(error);
    assert.match(detail, pattern);
    return true;
  });
}

async function createUser(overrides: { email?: string } = {}) {
  return prisma.user.create({
    data: { name: "Test Customer", email: overrides.email ?? `customer-${suffix()}@example.com` },
  });
}

async function createStockedVariant(onHand: number) {
  const product = await prisma.product.create({
    data: {
      slug: `ring-${suffix()}`,
      name: "Solitaire Ring",
      status: "ACTIVE",
      variants: { create: { sku: `NV-RING-${suffix()}`, title: "18K Gold / 7", price: "250000.00", isDefault: true } },
    },
    include: { variants: true },
  });
  const location = await prisma.inventoryLocation.create({ data: { code: `LOC-${suffix()}`, name: "Vault" } });
  const level = await prisma.inventoryLevel.create({
    data: { variantId: product.variants[0]!.id, locationId: location.id, onHand },
  });
  return { product, variant: product.variants[0]!, location, level };
}

/** The exact statement the inventory service uses to reserve stock. */
function reserve(levelId: string, quantity: number) {
  return prisma.$executeRaw`
    UPDATE inventory_levels
       SET reserved = reserved + ${quantity}, updated_at = now()
     WHERE id = ${levelId}::uuid
       AND on_hand - reserved >= ${quantity}`;
}

async function createOrder(totals: { subtotal: string; shipping: string; total: string }) {
  return prisma.order.create({
    data: {
      email: `buyer-${suffix()}@example.com`,
      phone: "+923001234567",
      subtotal: totals.subtotal,
      shippingTotal: totals.shipping,
      total: totals.total,
      paymentMethodCode: "cod",
    },
  });
}

describe("identity", () => {
  test("emails must be stored lower-case", async () => {
    await rejectsWith(() => createUser({ email: `Mixed-${suffix()}@Example.com` }), /users_email_lowercase_chk/);
  });
});

describe("inventory", () => {
  test("stock can never be over-reserved, even under concurrency", async () => {
    const { level } = await createStockedVariant(3);

    const results = await Promise.all(Array.from({ length: 8 }, () => reserve(level.id, 1)));

    assert.equal(results.filter((rows) => rows === 1).length, 3, "exactly three reservations succeed");
    const after = await prisma.inventoryLevel.findUniqueOrThrow({ where: { id: level.id } });
    assert.equal(after.reserved, 3);
    assert.equal(after.onHand, 3);
  });

  test("CHECK blocks a buggy unconditional over-reservation", async () => {
    const { level } = await createStockedVariant(1);
    await rejectsWith(
      () => prisma.inventoryLevel.update({ where: { id: level.id }, data: { reserved: 2 } }),
      /inventory_levels_reserved_chk/,
    );
  });

  test("inventory ledger is append-only", async () => {
    const { variant, location } = await createStockedVariant(1);
    const movement = await prisma.inventoryMovement.create({
      data: {
        variantId: variant.id,
        locationId: location.id,
        type: "RECEIPT",
        onHandDelta: 1,
        onHandAfter: 1,
        reservedAfter: 0,
      },
    });
    await rejectsWith(
      () => prisma.inventoryMovement.update({ where: { id: movement.id }, data: { reason: "edited" } }),
      /append-only/,
    );
    await rejectsWith(() => prisma.inventoryMovement.delete({ where: { id: movement.id } }), /append-only/);
  });
});

describe("orders", () => {
  test("order numbers start at 100001", async () => {
    const order = await createOrder({ subtotal: "1000.00", shipping: "250.00", total: "1250.00" });
    assert.ok(order.number >= 100001);
  });

  test("totals must add up", async () => {
    await rejectsWith(
      () => createOrder({ subtotal: "1000.00", shipping: "250.00", total: "1000.00" }),
      /orders_total_arithmetic_chk/,
    );
  });
});

describe("payments", () => {
  test("cannot refund more than was captured", async () => {
    const order = await createOrder({ subtotal: "1000.00", shipping: "0.00", total: "1000.00" });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        providerCode: "bank_transfer",
        methodType: "BANK_TRANSFER",
        status: "CAPTURED",
        amount: "1000.00",
        amountCaptured: "1000.00",
        currency: "PKR",
        idempotencyKey: randomUUID(),
      },
    });
    await rejectsWith(
      () => prisma.payment.update({ where: { id: payment.id }, data: { amountRefunded: "1000.01" } }),
      /payments_refunded_chk/,
    );
  });

  test("payment ledger is append-only", async () => {
    const order = await createOrder({ subtotal: "500.00", shipping: "0.00", total: "500.00" });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        providerCode: "cod",
        methodType: "CASH_ON_DELIVERY",
        amount: "500.00",
        currency: "PKR",
        idempotencyKey: randomUUID(),
        events: { create: { type: "initiated", toStatus: "PENDING", actorType: "SYSTEM" } },
      },
      include: { events: true },
    });
    await rejectsWith(
      () => prisma.paymentEvent.update({ where: { id: payment.events[0]!.id }, data: { type: "tampered" } }),
      /append-only/,
    );
  });
});

describe("coupons", () => {
  test("codes must be normalised upper-case", async () => {
    await rejectsWith(
      () => prisma.coupon.create({ data: { code: `eid-${suffix()}`, type: "PERCENTAGE", value: "10" } }),
      /coupons_code_format_chk/,
    );
  });

  test("usage limit holds under concurrent redemption", async () => {
    const coupon = await prisma.coupon.create({
      data: { code: `VIP${suffix().toUpperCase()}`, type: "FIXED_AMOUNT", value: "5000", usageLimit: 2 },
    });
    const redeem = () => prisma.$executeRaw`
      UPDATE coupons SET usage_count = usage_count + 1, updated_at = now()
       WHERE id = ${coupon.id}::uuid
         AND is_active
         AND (usage_limit IS NULL OR usage_count < usage_limit)`;

    const results = await Promise.all(Array.from({ length: 6 }, redeem));

    assert.equal(results.filter((rows) => rows === 1).length, 2);
    await rejectsWith(
      () => prisma.coupon.update({ where: { id: coupon.id }, data: { usageCount: 3 } }),
      /coupons_usage_chk/,
    );
  });
});

describe("customers", () => {
  test("at most one default shipping address per user", async () => {
    const user = await createUser();
    const address = {
      userId: user.id,
      fullName: "Ayesha Khan",
      phone: "+923001234567",
      line1: "House 12, Street 4",
      area: "DHA Phase 6",
      cityName: "Lahore",
      isDefaultShipping: true,
    };
    await prisma.address.create({ data: address });
    await rejectsWith(() => prisma.address.create({ data: address }), /addresses_one_default_shipping_per_user_uq|Unique constraint/);
  });

  test("review ratings are 1-5", async () => {
    const user = await createUser();
    const { product } = await createStockedVariant(1);
    await rejectsWith(
      () => prisma.review.create({ data: { productId: product.id, userId: user.id, rating: 6, body: "Exquisite." } }),
      /reviews_rating_chk/,
    );
  });
});

describe("audit log", () => {
  test("is append-only, but survives deletion of the actor", async () => {
    const actor = await createUser();
    const log = await prisma.auditLog.create({
      data: { actorType: "STAFF", actorId: actor.id, action: "product.update", entityType: "product", entityId: "x" },
    });

    await rejectsWith(
      () => prisma.auditLog.update({ where: { id: log.id }, data: { action: "product.delete" } }),
      /append-only/,
    );
    await rejectsWith(() => prisma.auditLog.delete({ where: { id: log.id } }), /append-only/);

    await prisma.user.delete({ where: { id: actor.id } });
    const kept = await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } });
    assert.equal(kept.actorId, null);
    assert.equal(kept.action, "product.update");
  });
});

describe("outbox", () => {
  test("concurrent dispatchers never claim the same event", async () => {
    const type = `test.event.${suffix()}`;
    await prisma.outboxEvent.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({ type, aggregateType: "test", aggregateId: String(i), payload: {} })),
    });

    const claim = (worker: string) =>
      prisma.$queryRaw<{ id: string }[]>`
        UPDATE outbox_events
           SET status = 'PROCESSING', locked_at = now(), locked_by = ${worker}, attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM outbox_events
            WHERE status = 'PENDING' AND available_at <= now() AND type = ${type}
            ORDER BY available_at
            LIMIT 4
            FOR UPDATE SKIP LOCKED)
        RETURNING id`;

    const claimed = (await Promise.all([claim("a"), claim("b"), claim("c")])).flat().map((row) => row.id);

    assert.equal(new Set(claimed).size, claimed.length, "no event claimed twice");
    assert.equal(claimed.length, 6, "all events claimed exactly once");
  });
});
