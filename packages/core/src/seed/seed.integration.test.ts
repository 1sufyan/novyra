import { afterAll, describe, expect, test } from "vitest";

import { ALL_PERMISSIONS, ROLE_TEMPLATES } from "@novyra/auth/permissions";

import { testPrisma } from "../../tests/db.ts";
import { defaultSettings, getSetting, setSetting } from "../settings/index.ts";
import { seedReferenceData } from "./index.ts";
import { PAKISTAN_CITIES } from "./reference-data.ts";

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

describe("seedReferenceData", () => {
  test("creates the reference data and is idempotent", async () => {
    const first = await seedReferenceData(prisma);
    const second = await seedReferenceData(prisma);
    expect(second).toEqual({ ...first, removedPermissions: 0 });

    expect(await prisma.permission.count()).toBe(ALL_PERMISSIONS.length);
    for (const template of ROLE_TEMPLATES) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { key: template.key },
        include: { permissions: { include: { permission: true } } },
      });
      expect(role.isSystem).toBe(true);
      expect(role.permissions.map((rp) => rp.permission.key).sort()).toEqual(
        [...template.permissions].sort(),
      );
    }

    const cities = await prisma.city.findMany({ where: { countryCode: "PK" }, include: { zone: true } });
    expect(cities.length).toBeGreaterThanOrEqual(PAKISTAN_CITIES.length);
    expect(cities.every((city) => city.zoneId)).toBe(true);

    const payments = await prisma.paymentMethod.findMany({ orderBy: { position: "asc" } });
    expect(payments.map((p) => [p.providerCode, p.isEnabled])).toEqual([
      ["cod", true],
      ["bank_transfer", false],
    ]);
    expect(await prisma.inventoryLocation.count({ where: { isDefault: true } })).toBe(1);
    expect(await getSetting(prisma, "cod")).toEqual(defaultSettings.cod);
  });

  test("never overwrites what the owner changed in admin", async () => {
    await seedReferenceData(prisma);
    await prisma.paymentMethod.update({
      where: { providerCode: "cod" },
      data: { displayName: "Pay on delivery" },
    });
    await setSetting(prisma, "cod", { ...defaultSettings.cod, maxOrderTotalWithoutAdvance: "75000.00" });
    const lahoreZone = await prisma.shippingZone.create({ data: { name: "Lahore", countryCode: "PK" } });
    await prisma.city.update({
      where: { countryCode_name: { countryCode: "PK", name: "Lahore" } },
      data: { zoneId: lahoreZone.id },
    });

    await seedReferenceData(prisma);

    expect(
      (await prisma.paymentMethod.findUniqueOrThrow({ where: { providerCode: "cod" } })).displayName,
    ).toBe("Pay on delivery");
    expect((await getSetting(prisma, "cod")).maxOrderTotalWithoutAdvance).toBe("75000.00");
    expect(
      (
        await prisma.city.findUniqueOrThrow({
          where: { countryCode_name: { countryCode: "PK", name: "Lahore" } },
        })
      ).zoneId,
    ).toBe(lahoreZone.id);
  });

  test("restores a system role's permissions if they were tampered with", async () => {
    await seedReferenceData(prisma);
    const support = await prisma.role.findUniqueOrThrow({ where: { key: "support" } });
    const staffManage = await prisma.permission.findUniqueOrThrow({ where: { key: "staff:manage" } });
    await prisma.rolePermission.create({ data: { roleId: support.id, permissionId: staffManage.id } });

    await seedReferenceData(prisma);

    const granted = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: support.id, permissionId: staffManage.id } },
    });
    expect(granted).toBeNull();
  });
});

describe("settings", () => {
  test("invalid values are rejected on write", async () => {
    await expect(
      setSetting(prisma, "returns", { windowDays: -1, personalisedItemsReturnable: false }),
    ).rejects.toThrow();
  });
});
