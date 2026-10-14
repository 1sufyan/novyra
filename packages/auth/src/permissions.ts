/**
 * The permission catalogue: the single source of truth for what staff can be allowed to do.
 * Code checks these keys; the seed syncs them into the `permissions` table. The templates below
 * define the built-in system roles, which are read-only: every seed resets them. The owner grants
 * other combinations through custom roles, which the seed never touches.
 * Matrix and rationale: docs/03-security.md §4.
 */

export const PERMISSIONS = {
  "admin:access": "Sign in to the admin dashboard",
  "dashboard:view": "View the dashboard and work queues",
  "analytics:view": "View sales and marketing reports",
  "products:read": "View products, collections and categories",
  "products:write": "Create and edit products, collections and categories",
  "products:publish": "Publish and archive products",
  "content:manage": "Manage storefront content (home, navigation, editorial)",
  "media:upload": "Upload images and video",
  "inventory:read": "View stock levels and movements",
  "inventory:adjust": "Adjust stock and record receipts",
  "orders:read": "View orders",
  "orders:update": "Add notes, verify COD orders, put orders on hold",
  "orders:cancel": "Cancel orders",
  "orders:export": "Export order data",
  "customers:read": "View customer records",
  "customers:update": "Edit customer records",
  "customers:erase": "Anonymise a customer account",
  "payments:read": "View payments",
  "payments:verify": "Verify bank transfers and record COD collection",
  "refunds:create": "Create refunds",
  "refunds:approve": "Approve refunds above the threshold (not one's own)",
  "shipments:manage": "Book, cancel and update shipments",
  "returns:manage": "Approve, receive and inspect returns",
  "reviews:moderate": "Approve and reject reviews",
  "coupons:manage": "Create and edit coupons",
  "settings:manage": "Change store settings",
  "shipping_settings:manage": "Change shipping zones, methods and rates",
  "payment_methods:manage": "Enable and configure payment methods",
  "staff:manage": "Invite staff and assign roles",
  "audit:read": "Read the audit log",
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

export interface RoleTemplate {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
}

const EVERYONE: readonly Permission[] = ["admin:access", "dashboard:view"];

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: "owner",
    name: "Owner",
    description: "Full access, including staff and payment configuration.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "store_manager",
    name: "Store manager",
    description: "Runs day-to-day operations. Cannot manage staff, payment methods or erase customers.",
    permissions: [
      ...EVERYONE,
      "analytics:view",
      "products:read",
      "products:write",
      "products:publish",
      "content:manage",
      "media:upload",
      "inventory:read",
      "inventory:adjust",
      "orders:read",
      "orders:update",
      "orders:cancel",
      "orders:export",
      "customers:read",
      "customers:update",
      "payments:read",
      "payments:verify",
      "refunds:create",
      "shipments:manage",
      "returns:manage",
      "reviews:moderate",
      "coupons:manage",
      "settings:manage",
      "shipping_settings:manage",
    ],
  },
  {
    key: "finance",
    name: "Finance",
    description: "Payments, refunds, reconciliation and reporting.",
    permissions: [
      ...EVERYONE,
      "analytics:view",
      "products:read",
      "inventory:read",
      "orders:read",
      "orders:export",
      "customers:read",
      "payments:read",
      "payments:verify",
      "refunds:create",
      "refunds:approve",
      "payment_methods:manage",
      "audit:read",
    ],
  },
  {
    key: "fulfilment",
    name: "Fulfilment",
    description: "Packs and ships orders, manages stock and returns.",
    permissions: [
      ...EVERYONE,
      "products:read",
      "inventory:read",
      "inventory:adjust",
      "orders:read",
      "orders:update",
      "customers:read",
      "shipments:manage",
      "returns:manage",
    ],
  },
  {
    key: "support",
    name: "Customer support",
    description: "Helps customers with orders, returns and reviews.",
    permissions: [
      ...EVERYONE,
      "products:read",
      "inventory:read",
      "orders:read",
      "orders:update",
      "orders:cancel",
      "customers:read",
      "customers:update",
      "payments:read",
      "returns:manage",
      "reviews:moderate",
    ],
  },
  {
    key: "content_editor",
    name: "Content editor",
    description: "Maintains the catalogue, imagery and storefront content.",
    permissions: [
      ...EVERYONE,
      "products:read",
      "products:write",
      "products:publish",
      "content:manage",
      "media:upload",
      "inventory:read",
      "reviews:moderate",
    ],
  },
];
