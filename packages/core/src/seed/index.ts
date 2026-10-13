import { ALL_PERMISSIONS, PERMISSIONS, ROLE_TEMPLATES } from "@novyra/auth/permissions";
import { withTransaction, type Prisma, type PrismaClient, type Tx } from "@novyra/db";

import { SETTING_KEYS, defaultSettings } from "../settings/index.ts";
import {
  DEFAULT_LOCATION,
  DEFAULT_ZONE,
  PAKISTAN_CITIES,
  PAYMENT_METHODS,
  SHIPPING_METHODS,
} from "./reference-data.ts";

export interface SeedSummary {
  permissions: number;
  removedPermissions: number;
  roles: number;
  cities: number;
  shippingMethods: number;
  paymentMethods: number;
  settings: number;
}

/**
 * Idempotent: safe to run on every deploy. Code-owned data (permissions, system roles' permission
 * sets) is synced to the code. Everything the owner may edit in admin (cities, zones, methods,
 * settings, the stock location) is only created when missing, never overwritten.
 */
export async function seedReferenceData(prisma: PrismaClient): Promise<SeedSummary> {
  return withTransaction(prisma, (tx) => seedInTransaction(tx), { timeoutMs: 60_000 });
}

async function seedInTransaction(tx: Tx): Promise<SeedSummary> {
  // Permissions: exactly the catalogue in code.
  for (const key of ALL_PERMISSIONS) {
    await tx.permission.upsert({
      where: { key },
      create: { key, description: PERMISSIONS[key] },
      update: { description: PERMISSIONS[key] },
    });
  }
  const removed = await tx.permission.deleteMany({ where: { key: { notIn: ALL_PERMISSIONS } } });

  // System roles: names are editable by nobody; their permission sets follow the templates.
  const permissionIds = new Map(
    (await tx.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
  );
  for (const template of ROLE_TEMPLATES) {
    const role = await tx.role.upsert({
      where: { key: template.key },
      create: { key: template.key, name: template.name, description: template.description, isSystem: true },
      update: { name: template.name, description: template.description, isSystem: true },
    });
    const wanted = template.permissions.map((key) => permissionIds.get(key)!);
    await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted } } });
    await tx.rolePermission.createMany({
      data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  // Default shipping zone for Pakistan (exactly one default per country, partial unique index).
  const zone =
    (await tx.shippingZone.findFirst({
      where: { countryCode: DEFAULT_ZONE.countryCode, isDefault: true },
    })) ?? (await tx.shippingZone.create({ data: { ...DEFAULT_ZONE, isDefault: true } }));

  // Cities: create missing ones in the default zone; existing rows (and their zone) are left alone.
  await tx.city.createMany({
    data: PAKISTAN_CITIES.map((city) => ({ ...city, countryCode: "PK", zoneId: zone.id })),
    skipDuplicates: true,
  });

  await tx.shippingMethod.createMany({ data: [...SHIPPING_METHODS], skipDuplicates: true });
  await tx.paymentMethod.createMany({ data: [...PAYMENT_METHODS], skipDuplicates: true });

  // The one default stock location.
  const hasDefaultLocation = await tx.inventoryLocation.findFirst({ where: { isDefault: true } });
  if (!hasDefaultLocation) {
    await tx.inventoryLocation.upsert({
      where: { code: DEFAULT_LOCATION.code },
      create: { ...DEFAULT_LOCATION, isDefault: true },
      update: { isDefault: true },
    });
  }

  // Settings: defaults only where unset.
  await tx.setting.createMany({
    data: SETTING_KEYS.map((key) => ({ key, value: defaultSettings[key] as Prisma.InputJsonValue })),
    skipDuplicates: true,
  });

  return {
    permissions: ALL_PERMISSIONS.length,
    removedPermissions: removed.count,
    roles: ROLE_TEMPLATES.length,
    cities: await tx.city.count(),
    shippingMethods: await tx.shippingMethod.count(),
    paymentMethods: await tx.paymentMethod.count(),
    settings: await tx.setting.count(),
  };
}
