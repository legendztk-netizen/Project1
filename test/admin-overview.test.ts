import { expect, it, vi } from "vitest";
import type { AdminIdentity } from "../workers/admin-access";
import { readAdminOverview } from "../app/modules/admin/infrastructure/admin-overview";
const actor = (moduleAccess: AdminIdentity["moduleAccess"]): AdminIdentity => ({
  id: "staff",
  email: "staff@tests.invalid",
  accountType: "subaccount",
  canManageSubaccounts: false,
  source: "password",
  moduleAccess,
});
const deniedDatabase = () => ({
  prepare: vi.fn(() => {
    throw new Error("Unauthorized query");
  }),
});
it("does not query or return business data for an account without module grants", async () => {
  const db = deniedDatabase();
  expect(
    await readAdminOverview(db as unknown as D1Database, actor({})),
  ).toMatchObject({ metrics: [], shortcuts: [] });
  expect(db.prepare).not.toHaveBeenCalled();
});
it("keeps configurator-only access independent of product and other business counts", async () => {
  const db = deniedDatabase();
  const result = await readAdminOverview(
    db as unknown as D1Database,
    actor({ configurator: "read" }),
  );
  expect(result.metrics).toEqual([]);
  expect(result.shortcuts).toHaveLength(1);
  expect(result.shortcuts[0]).toMatchObject({
    to: "/admin/catalog/reference-data",
    readonly: true,
  });
  expect(db.prepare).not.toHaveBeenCalled();
});
it("queries only authorized metrics and points to the matching actionable filter", async () => {
  const db = {
    prepare: vi.fn((sql: string) => {
      expect(sql).toContain(
        "catalog_product_change_requests WHERE status='pending'",
      );
      return { first: async () => ({ count: 7 }) };
    }),
  };
  const result = await readAdminOverview(
    db as unknown as D1Database,
    actor({ catalog: "read" }),
  );
  expect(result.metrics).toEqual([
    expect.objectContaining({
      key: "catalog",
      count: 7,
      to: "/admin/catalog/requests?status=pending",
    }),
  ]);
  expect(result.shortcuts.map((item) => item.key)).toEqual([
    "products",
    "catalog",
  ]);
  expect(result.shortcuts.every((item) => item.readonly)).toBe(true);
  expect(db.prepare).toHaveBeenCalledOnce();
});
