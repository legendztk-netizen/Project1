import {
  ADMIN_MODULES,
  type ModuleAccess,
} from "../domain/admin-module-access";
import { adminPasswordHash } from "./admin-password-auth";
export function createAdminAccounts(db: D1Database) {
  return {
    async list() {
      const [accounts, grants] = await db.batch<Record<string, unknown>>([
        db.prepare(
          `SELECT id,username,display_name AS name,email,account_type AS accountType,status,permissions_version AS version FROM admin_identities WHERE deleted_at IS NULL ORDER BY account_type='owner' DESC,created_at`,
        ),
        db.prepare(
          "SELECT admin_id,module,level FROM admin_module_permissions",
        ),
      ]);
      return accounts.results.map((r) => ({
        ...r,
        permissions: Object.fromEntries(
          grants.results
            .filter((g) => g.admin_id === r.id)
            .map((g) => [g.module, g.level]),
        ) as ModuleAccess,
      })) as unknown as Array<{
        id: string;
        username: string | null;
        name: string;
        email: string;
        accountType: "owner" | "subaccount";
        status: "active" | "disabled";
        version: number;
        permissions: ModuleAccess;
      }>;
    },
    async mutate(ownerId: string, form: FormData) {
      const owner = await db
        .prepare(
          `SELECT id FROM admin_identities WHERE id=? AND account_type='owner' AND status='active' AND deleted_at IS NULL`,
        )
        .bind(ownerId)
        .first();
      if (!owner)
        throw new Response("只有主账号可以管理子账号", { status: 403 });
      const text = (k: string) => String(form.get(k) ?? "").trim();
      const intent = text("intent"),
        id = intent === "create" ? crypto.randomUUID() : text("id"),
        now = new Date().toISOString();
      if (
        ![
          "create",
          "permissions",
          "reset",
          "disable",
          "enable",
          "delete",
        ].includes(intent)
      )
        throw new Response("操作无效", { status: 400 });
      const permissions: ModuleAccess = {};
      for (const m of ADMIN_MODULES) {
        const v = text(`module.${m.key}`);
        if (v && !["none", "read", "write"].includes(v))
          throw new Response("权限无效", { status: 400 });
        if (v === "read" || v === "write") permissions[m.key] = v;
      }
      if (permissions.after_sales && !permissions.orders)
        throw new Response(
          "售后详情在订单页面处理，请同时授予订单与发货至少只读权限",
          { status: 400 },
        );
      const queries: D1PreparedStatement[] = [];
      let username = text("username").toLowerCase(),
        name = text("name");
      if (intent === "create") {
        if (!/^[a-z][a-z0-9_.-]{2,31}$/.test(username) || username === "admin")
          throw new Response(
            "用户名需为 3–32 位，以字母开头，可含数字、下划线、点和短横线；admin 为主账号保留。",
            { status: 400 },
          );
        if (!name || name.length > 60)
          throw new Response("请输入 1–60 字的姓名", { status: 400 });
        const hash = await adminPasswordHash(
          String(form.get("password") ?? ""),
        );
        if (
          await db
            .prepare(
              "SELECT id FROM admin_identities WHERE username=? COLLATE NOCASE",
            )
            .bind(username)
            .first()
        )
          throw new Response("用户名已使用，请选择其他用户名", { status: 409 });
        queries.push(
          db
            .prepare(
              `INSERT INTO admin_identities(id,email,username,display_name,password_hash,account_type,status,can_manage_subaccounts,created_at,updated_at,catalog_permission) VALUES(?,?,?,?,?,'subaccount','active',0,?,?,'view')`,
            )
            .bind(id, `${id}@admin.invalid`, username, name, hash, now, now),
        );
      } else {
        const target = await db
          .prepare(
            `SELECT username,display_name FROM admin_identities WHERE id=? AND account_type='subaccount' AND deleted_at IS NULL`,
          )
          .bind(id)
          .first<{ username: string; display_name: string }>();
        if (!target)
          throw new Response("子账号不存在，主账号不能被重置、禁用或删除", {
            status: 404,
          });
        username = target.username;
        name = target.display_name;
        const version = Number(text("version"));
        if (!Number.isSafeInteger(version) || version < 0)
          throw new Response("请刷新账号列表后重试", { status: 409 });
        const hash =
          intent === "reset"
            ? await adminPasswordHash(String(form.get("password") ?? ""))
            : null;
        queries.push(
          db
            .prepare(
              `UPDATE admin_identities SET permissions_version=permissions_version+1,updated_at=?,credential_version=credential_version+1,
     status=CASE WHEN ? IN ('disable','delete') THEN 'disabled' WHEN ?='enable' THEN 'active' ELSE status END,
     deleted_at=CASE WHEN ?='delete' THEN ? ELSE deleted_at END,
     password_hash=CASE WHEN ?='delete' THEN NULL WHEN ?='reset' THEN ? ELSE password_hash END
     WHERE id=? AND account_type='subaccount' AND permissions_version=? AND deleted_at IS NULL`,
            )
            .bind(
              now,
              intent,
              intent,
              intent,
              now,
              intent,
              intent,
              hash,
              id,
              version,
            ),
        );
        queries.push(
          db.prepare(
            "INSERT INTO admin_permission_write_assertions(failed) SELECT 1 WHERE changes()!=1",
          ),
        );
        queries.push(
          db
            .prepare("DELETE FROM admin_password_sessions WHERE admin_id=?")
            .bind(id),
        );
      }
      if (["create", "permissions", "delete"].includes(intent)) {
        queries.push(
          db
            .prepare("DELETE FROM admin_module_permissions WHERE admin_id=?")
            .bind(id),
        );
        if (intent !== "delete")
          for (const [module, level] of Object.entries(permissions))
            queries.push(
              db
                .prepare(
                  "INSERT INTO admin_module_permissions(admin_id,module,level) VALUES(?,?,?)",
                )
                .bind(id, module, level),
            );
        queries.push(
          db
            .prepare(
              "UPDATE admin_identities SET catalog_permission=? WHERE id=?",
            )
            .bind(
              permissions.catalog === "write" && intent !== "delete"
                ? "edit"
                : "view",
              id,
            ),
        );
        // Keep the existing after-sales domain guards aligned with module grants.
        queries.push(
          db
            .prepare("DELETE FROM admin_identity_permissions WHERE admin_id=?")
            .bind(id),
        );
        if (intent !== "delete" && permissions.after_sales)
          for (const permission of [
            "after_sales.review",
            ...(permissions.after_sales === "write"
              ? ["after_sales.refund"]
              : []),
          ])
            queries.push(
              db
                .prepare(
                  "INSERT INTO admin_identity_permissions(admin_id,permission,granted_by,granted_at) VALUES(?,?,?,?)",
                )
                .bind(id, permission, ownerId, now),
            );
      }
      queries.push(
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) VALUES(?,?,'admin_identity',?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            `admin.account_${intent}`,
            id,
            ownerId,
            JSON.stringify({
              username,
              name,
              ...(["create", "permissions"].includes(intent)
                ? { permissions }
                : {}),
            }),
            now,
          ),
      );
      try {
        await db.batch(queries);
      } catch (error) {
        if (
          error instanceof Error &&
          /UNIQUE|Concurrent permission change/.test(error.message)
        )
          throw new Response("账号已变更或用户名已使用，请刷新后重试", {
            status: 409,
          });
        throw error;
      }
      return id;
    },
  };
}
