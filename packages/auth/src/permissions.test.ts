import { describe, expect, test } from "vitest";

import { ALL_PERMISSIONS, PERMISSIONS, ROLE_TEMPLATES, isPermission } from "./permissions.ts";

describe("permission catalogue", () => {
  test("keys follow the resource:action format", () => {
    for (const key of ALL_PERMISSIONS) expect(key).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  test("every role grants admin access and only known permissions, without duplicates", () => {
    for (const role of ROLE_TEMPLATES) {
      expect(role.permissions).toContain("admin:access");
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
      for (const permission of role.permissions) expect(Object.hasOwn(PERMISSIONS, permission)).toBe(true);
    }
  });

  test("role keys are unique", () => {
    const keys = ROLE_TEMPLATES.map((role) => role.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("the owner has every permission", () => {
    const owner = ROLE_TEMPLATES.find((role) => role.key === "owner");
    expect(new Set(owner?.permissions)).toEqual(new Set(ALL_PERMISSIONS));
  });

  test("high-risk permissions stay with the roles docs/03-security.md assigns them to", () => {
    const holders = (permission: string) =>
      ROLE_TEMPLATES.filter((role) => (role.permissions as readonly string[]).includes(permission))
        .map((role) => role.key)
        .sort();
    expect(holders("staff:manage")).toEqual(["owner"]);
    expect(holders("customers:erase")).toEqual(["owner"]);
    expect(holders("refunds:approve")).toEqual(["finance", "owner"]);
    expect(holders("payment_methods:manage")).toEqual(["finance", "owner"]);
    expect(holders("audit:read")).toEqual(["finance", "owner"]);
  });

  test("isPermission narrows strings", () => {
    expect(isPermission("orders:read")).toBe(true);
    expect(isPermission("orders:delete")).toBe(false);
  });
});
