import { z } from "zod";

import type { Prisma, PrismaClient, Tx } from "@novyra/db";

/**
 * Store-wide, non-secret settings (the `settings` table). Every key has a schema here; values are
 * validated on read and write. Defaults follow the decisions in docs/08-implementation-plan.md.
 */

const decimalAmount = z.string().regex(/^\d+(\.\d{1,2})?$/, "must be a decimal amount, e.g. 50000.00");

export const settingSchemas = {
  store: z.object({
    name: z.string().min(1),
    currency: z.literal("PKR"),
    timezone: z.string().min(1),
    supportEmail: z.email().nullable(),
    supportPhone: z.string().nullable(),
  }),
  tax: z.object({
    /** D9 (open): default follows the recommendation, prices shown tax-inclusive. */
    pricesIncludeTax: z.boolean(),
  }),
  cod: z.object({
    /** D4: COD without an advance is allowed up to this order total. */
    maxOrderTotalWithoutAdvance: decimalAmount,
    /** D4: advance required above the limit, as a percentage of the order. Set by the owner; null = not yet set. */
    advancePercent: z.number().int().min(1).max(100).nullable(),
    /** D4: every COD order is confirmed by WhatsApp or phone. */
    verificationRequired: z.boolean(),
    feeFixed: decimalAmount,
  }),
  returns: z.object({
    /** D8. */
    windowDays: z.number().int().min(0).max(365),
    personalisedItemsReturnable: z.boolean(),
  }),
  inventory: z.object({
    /** Unpaid online orders release their stock after this many minutes. */
    reservationTtlMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export const SETTING_KEYS = Object.keys(settingSchemas) as SettingKey[];

export const defaultSettings: { readonly [K in SettingKey]: SettingValue<K> } = {
  store: {
    name: "NOVYRA",
    currency: "PKR",
    timezone: "Asia/Karachi",
    supportEmail: null,
    supportPhone: null,
  },
  tax: { pricesIncludeTax: true },
  cod: {
    maxOrderTotalWithoutAdvance: "50000.00",
    advancePercent: null,
    verificationRequired: true,
    feeFixed: "0.00",
  },
  returns: { windowDays: 7, personalisedItemsReturnable: false },
  inventory: { reservationTtlMinutes: 30 },
};

/** Reads a setting, falling back to its default when unset. Throws if a stored value is invalid. */
export async function getSetting<K extends SettingKey>(
  db: PrismaClient | Tx,
  key: K,
): Promise<SettingValue<K>> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return defaultSettings[key];
  return settingSchemas[key].parse(row.value) as SettingValue<K>;
}

/** Validates and stores a setting. `updatedById` is the staff member making the change. */
export async function setSetting<K extends SettingKey>(
  db: PrismaClient | Tx,
  key: K,
  value: SettingValue<K>,
  updatedById: string | null = null,
): Promise<void> {
  const parsed = settingSchemas[key].parse(value) as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { key },
    create: { key, value: parsed, updatedById },
    update: { value: parsed, updatedById },
  });
}
