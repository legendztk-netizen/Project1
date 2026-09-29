import { beforeAll, afterAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getPlatformProxy } from "wrangler";
import { createAdminAccounts } from "../app/modules/admin/infrastructure/d1-admin-accounts";
import {
  changeOwnerPassword,
  adminPasswordHash,
  loginAdmin,
  readAdminSession,
  logoutAdmin,
  tokenDigest,
} from "../app/modules/admin/infrastructure/admin-password-auth";
import { canAccessAdminPath } from "../app/modules/admin/domain/admin-module-access";
const directory = mkdtempSync(join(tmpdir(), "admin-password-test-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const password = "Test-Owner-9462";
const req = (cookie = "") =>
  new Request("https://admin.example.test/admin", {
    headers: { cookie, "cf-connecting-ip": "192.0.2.1" },
  });
const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};
beforeAll(async () => {
  const migration = spawnSync(
    "node",
    ["scripts/d1-migrations.mjs", "apply", "local"],
    {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, D1_PERSIST_TO: directory },
    },
  );
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{ DB: D1Database }>({
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  await db
    .prepare(
      `INSERT INTO admin_identities(id,email,username,display_name,password_hash,account_type,status,created_at,updated_at) VALUES('test-owner','owner@test.invalid','admin','主账号',?,'owner','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    )
    .bind(await adminPasswordHash(password))
    .run();
}, 90000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});
it("requires valid credentials, stores only token digests, and expires/revokes sessions", async () => {
  expect(await readAdminSession(db, req())).toBeNull();
  await expect(
    loginAdmin(db, req(), "admin", "incorrect"),
  ).rejects.toMatchObject({ status: 400 });
  const cookie = await loginAdmin(db, req(), "ADMIN", password);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=Strict");
  expect(await readAdminSession(db, req(cookie))).toMatchObject({
    accountType: "owner",
    username: "admin",
  });
  const row = await db
    .prepare("SELECT token_hash FROM admin_password_sessions")
    .first<{ token_hash: string }>();
  expect(cookie).not.toContain(row!.token_hash);
  await logoutAdmin(db, req(cookie));
  expect(await readAdminSession(db, req(cookie))).toBeNull();
  const expiryCookie = await loginAdmin(db, req(), "admin", password);
  await db
    .prepare(
      "UPDATE admin_password_sessions SET expires_at='2000-01-01T00:00:00.000Z'",
    )
    .run();
  expect(await readAdminSession(db, req(expiryCookie))).toBeNull();
});
it("creates minimal accounts and enforces each module on pages and mutation resources", async () => {
  const repo = createAdminAccounts(db);
  const id = await repo.mutate(
    "test-owner",
    form({ intent: "create", username: "worker1", name: "员工甲", password }),
  );
  let cookie = await loginAdmin(db, req(), "worker1", password);
  let identity = (await readAdminSession(db, req(cookie)))!;
  expect(canAccessAdminPath(identity, "/admin/catalog/products", "GET")).toBe(
    false,
  );
  await repo.mutate(
    "test-owner",
    form({
      intent: "permissions",
      id,
      version: "0",
      "module.catalog": "read",
      "module.orders": "write",
    }),
  );
  expect(await readAdminSession(db, req(cookie))).toBeNull();
  cookie = await loginAdmin(db, req(), "worker1", password);
  identity = (await readAdminSession(db, req(cookie)))!;
  expect(
    canAccessAdminPath(identity, "/admin/catalog/products.data", "GET"),
  ).toBe(true);
  expect(
    canAccessAdminPath(identity, "/admin/catalog/products.data", "POST"),
  ).toBe(false);
  expect(canAccessAdminPath(identity, "/admin/orders/order1", "POST")).toBe(
    true,
  );
  expect(canAccessAdminPath(identity, "/admin/messages", "GET")).toBe(false);
  expect(
    canAccessAdminPath(identity, "/admin/settings/permissions", "POST"),
  ).toBe(false);
  expect(
    canAccessAdminPath(identity, "/admin/new-unclassified-resource", "GET"),
  ).toBe(false);
  await expect(
    repo.mutate(
      id,
      form({ intent: "create", username: "evil", name: "Evil", password }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    repo.mutate(
      "test-owner",
      form({ intent: "reset", id: "test-owner", version: "0", password }),
    ),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    repo.mutate(
      "test-owner",
      form({
        intent: "create",
        username: "WORKER1",
        name: "Duplicate",
        password,
      }),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("invalidates old sessions on reset/disable/delete, preserves audit attribution and rejects stale commands", async () => {
  const repo = createAdminAccounts(db);
  const staff = (await repo.list()).find((a) => a.username === "worker1")!;
  const oldCookie = await loginAdmin(db, req(), "worker1", password);
  const newPassword = "Changed-Password-8246";
  await repo.mutate(
    "test-owner",
    form({
      intent: "reset",
      id: staff.id,
      version: "1",
      password: newPassword,
    }),
  );
  expect(await readAdminSession(db, req(oldCookie))).toBeNull();
  await expect(
    loginAdmin(db, req(), "worker1", password),
  ).rejects.toMatchObject({ status: 400 });
  let cookie = await loginAdmin(db, req(), "worker1", newPassword);
  await expect(
    repo.mutate(
      "test-owner",
      form({ intent: "disable", id: staff.id, version: "1" }),
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(await readAdminSession(db, req(cookie))).not.toBeNull();
  await repo.mutate(
    "test-owner",
    form({ intent: "disable", id: staff.id, version: "2" }),
  );
  expect(await readAdminSession(db, req(cookie))).toBeNull();
  await expect(
    loginAdmin(db, req(), "worker1", newPassword),
  ).rejects.toMatchObject({ status: 400 });
  await repo.mutate(
    "test-owner",
    form({ intent: "enable", id: staff.id, version: "3" }),
  );
  cookie = await loginAdmin(db, req(), "worker1", newPassword);
  await repo.mutate(
    "test-owner",
    form({ intent: "delete", id: staff.id, version: "4" }),
  );
  expect(await readAdminSession(db, req(cookie))).toBeNull();
  expect((await repo.list()).some((a) => a.id === staff.id)).toBe(false);
  expect(
    await db
      .prepare("SELECT password_hash,status FROM admin_identities WHERE id=?")
      .bind(staff.id)
      .first(),
  ).toEqual({ password_hash: null, status: "disabled" });
  const audit = await db
    .prepare("SELECT payload_json FROM admin_audit_events WHERE entity_id=?")
    .bind(staff.id)
    .all();
  expect(audit.results.length).toBe(6);
  expect(JSON.stringify(audit)).not.toContain(password);
  expect(JSON.stringify(audit)).not.toContain(newPassword);
  expect(JSON.stringify(audit)).not.toContain("derivedKey");
});
it("rate limits unknown accounts without revealing whether a username exists", async () => {
  for (let i = 0; i < 10; i++)
    await expect(
      loginAdmin(db, req(), "unknown", "wrong"),
    ).rejects.toMatchObject({ status: 400 });
  await expect(loginAdmin(db, req(), "unknown", "wrong")).rejects.toMatchObject(
    { status: 429 },
  );
});

it("requires the current Owner password before changing it and logs out all prior Owner sessions", async () => {
  await db.prepare("DELETE FROM admin_login_limits").run();
  const oldCookie = await loginAdmin(db, req(), "admin", password);
  await expect(
    changeOwnerPassword(db, req(), "test-owner", "wrong", "Next-Owner-3825"),
  ).rejects.toMatchObject({ status: 400 });
  expect(await readAdminSession(db, req(oldCookie))).not.toBeNull();
  await changeOwnerPassword(
    db,
    req(),
    "test-owner",
    password,
    "Next-Owner-3825",
  );
  expect(await readAdminSession(db, req(oldCookie))).toBeNull();
  await expect(loginAdmin(db, req(), "admin", password)).rejects.toMatchObject({
    status: 400,
  });
  expect(
    await readAdminSession(
      db,
      req(await loginAdmin(db, req(), "admin", "Next-Owner-3825")),
    ),
  ).toMatchObject({ username: "admin", accountType: "owner" });
  const events = await db
    .prepare(
      "SELECT payload_json FROM admin_audit_events WHERE event_type='admin.password_changed'",
    )
    .all();
  expect(events.results).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain("Next-Owner-3825");
});

it("does not charge successful sign-ins to shared-IP failure limits or erase other users' failures", async () => {
  await db.prepare("DELETE FROM admin_login_limits").run();
  const request = new Request("https://admin.example.test/admin/login", {
    headers: { "cf-connecting-ip": "192.0.2.222" },
  });
  await expect(
    loginAdmin(db, request, "missing-other-user", "wrong"),
  ).rejects.toMatchObject({ status: 400 });
  for (let i = 0; i < 35; i++) {
    const cookie = await loginAdmin(db, request, "admin", "Next-Owner-3825");
    expect(await readAdminSession(db, req(cookie))).not.toBeNull();
  }
  expect(
    await db
      .prepare("SELECT attempts FROM admin_login_limits WHERE key=?")
      .bind(`ip:${await tokenDigest("192.0.2.222")}`)
      .first("attempts"),
  ).toBe(1);
  // Parallel failures still reserve capacity atomically.
  const attempts = await Promise.allSettled(
    Array.from({ length: 32 }, (_, n) =>
      loginAdmin(db, request, `bad-${n}`, "wrong"),
    ),
  );
  expect(
    attempts.filter((r) => r.status === "rejected" && r.reason.status === 400),
  ).toHaveLength(29);
  expect(
    attempts.filter((r) => r.status === "rejected" && r.reason.status === 429),
  ).toHaveLength(3);
}, 60000);

it("persists independent configurator grants without granting product access", async () => {
  const repo = createAdminAccounts(db);
  const id = await repo.mutate(
    "test-owner",
    form({
      intent: "create",
      username: "assembly-only",
      name: "参数管理员",
      password,
    }),
  );
  await repo.mutate(
    "test-owner",
    form({
      intent: "permissions",
      id,
      version: "0",
      "module.configurator": "write",
    }),
  );
  const identity = (await readAdminSession(
    db,
    req(await loginAdmin(db, req(), "assembly-only", password)),
  ))!;
  expect(identity.moduleAccess).toEqual({ configurator: "write" });
  expect(
    canAccessAdminPath(identity, "/admin/catalog/reference-data.data", "POST"),
  ).toBe(true);
  expect(canAccessAdminPath(identity, "/admin/catalog/products", "GET")).toBe(
    false,
  );
  expect(identity.catalogPermission).toBe("view");
});
