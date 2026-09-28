import { afterAll, beforeAll, expect, it } from "vitest";

import { findActiveAdminIdentityByEmail } from "../app/modules/admin/infrastructure/d1-admin-identity-repository";
import { createD1AdminPermissions } from "../app/modules/admin/infrastructure/d1-admin-permissions";
import {
  fixtureClock,
  startAfterSalesDatabase,
} from "./fixtures/after-sales-order";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("admin-permissions");
  db = started.db;
  dispose = started.dispose;
  await db.batch([
    db
      .prepare(
        `INSERT INTO admin_identities
         (id,email,account_type,status,can_manage_subaccounts,created_at,updated_at)
         VALUES ('perm-owner','perm-owner@example.test','owner','active',1,?1,?1),
           ('perm-staff','perm-staff@example.test','subaccount','active',0,?1,?1)`,
      )
      .bind(fixtureClock),
  ]);
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const permissions = () => createD1AdminPermissions(db);
const staffPermissions = async () =>
  (await findActiveAdminIdentityByEmail(db, "perm-staff@example.test"))
    ?.permissions ?? [];

it("grants no after-sales permission to a subaccount until the Owner chooses it, and audits each change once", async () => {
  expect(await staffPermissions()).toEqual([]);
  const owner = (await permissions().list()).find(
    (account) => account.id === "perm-owner",
  );
  expect(owner?.permissions).toEqual([
    "after_sales.review",
    "after_sales.refund",
  ]);

  const grant = {
    ownerId: "perm-owner",
    adminId: "perm-staff",
    permissions: ["after_sales.review", "after_sales.refund"] as const,
    commandId: "11111111-1111-4111-8111-111111111111",
    timestamp: fixtureClock,
    auditIp: "local",
    expectedVersion: 0,
  };
  await permissions().setSubaccountPermissions(grant);
  // A replayed save changes nothing and writes no second audit event.
  await permissions().setSubaccountPermissions(grant);
  expect([...(await staffPermissions())].sort()).toEqual([
    "after_sales.refund",
    "after_sales.review",
  ]);

  await permissions().setSubaccountPermissions({
    ...grant,
    permissions: ["after_sales.review"],
    expectedVersion: 1,
    commandId: "22222222-2222-4222-8222-222222222222",
  });
  expect(await staffPermissions()).toEqual(["after_sales.review"]);

  const audits = (
    await db
      .prepare(
        `SELECT actor_id,payload_json FROM admin_audit_events
         WHERE event_type='admin.permissions_changed' AND entity_id='perm-staff'
         ORDER BY id`,
      )
      .all<{ actor_id: string; payload_json: string }>()
  ).results.map((row) => ({
    actor: row.actor_id,
    ...(JSON.parse(row.payload_json) as {
      granted: string[];
      revoked: string[];
    }),
  }));
  expect(audits).toMatchObject([
    {
      actor: "perm-owner",
      granted: ["after_sales.refund", "after_sales.review"],
      revoked: [],
    },
    { actor: "perm-owner", granted: [], revoked: ["after_sales.refund"] },
  ]);
});

it("refuses to edit the Owner or an unknown account through the subaccount command", async () => {
  await expect(
    permissions().setSubaccountPermissions({
      ownerId: "perm-owner",
      adminId: "perm-owner",
      permissions: [],
      commandId: "33333333-3333-4333-8333-333333333333",
      timestamp: fixtureClock,
      auditIp: null,
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ status: 404 });
});

it("rejects concurrent and stale replacements without merging grants or writing a false audit", async () => {
  const account = (await permissions().list()).find(
    (item) => item.id === "perm-staff",
  )!;
  const base = {
    ownerId: "perm-owner",
    adminId: "perm-staff",
    expectedVersion: account.version,
    timestamp: fixtureClock,
    auditIp: "192.0.2.10",
  };
  const results = await Promise.allSettled([
    permissions().setSubaccountPermissions({
      ...base,
      permissions: ["after_sales.review"],
      commandId: crypto.randomUUID(),
    }),
    permissions().setSubaccountPermissions({
      ...base,
      permissions: ["after_sales.refund"],
      commandId: crypto.randomUUID(),
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
  const final = (await permissions().list()).find(
    (item) => item.id === "perm-staff",
  )!;
  expect(final.version).toBe(account.version + 1);
  expect(final.permissions).toHaveLength(1);
  const audits = (
    await db
      .prepare(
        `SELECT payload_json FROM admin_audit_events
    WHERE event_type='admin.permissions_changed' AND entity_id='perm-staff'`,
      )
      .all<{ payload_json: string }>()
  ).results;
  const audit = audits
    .map((row) => JSON.parse(row.payload_json))
    .find((row) => row.expectedVersion === account.version);
  expect(audit.after).toEqual(final.permissions);
  await expect(
    permissions().setSubaccountPermissions({
      ...base,
      permissions: [],
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
});
