import {
  ADMIN_PERMISSIONS,
  isAdminPermission,
  type AdminPermission,
} from "../domain/admin-permissions";

export interface AdminAccountPermissions {
  id: string;
  email: string;
  accountType: "owner" | "subaccount";
  status: "active" | "disabled";
  permissions: AdminPermission[];
  version: number;
}

/**
 * Owner-managed Admin Permissions (ADR-0047). Each save sets one
 * subaccount's permissions to the chosen set and audits the change in the
 * same batch; a replayed command changes nothing.
 */
export function createD1AdminPermissions(db: D1Database) {
  return {
    async list(): Promise<AdminAccountPermissions[]> {
      const rows = (
        await db
          .prepare(
            `SELECT i.id,i.email,i.account_type,i.status,i.permissions_version,
               (SELECT group_concat(p.permission) FROM admin_identity_permissions p
                 WHERE p.admin_id=i.id) AS permissions
             FROM admin_identities i
             ORDER BY i.account_type='owner' DESC,i.status,i.email`,
          )
          .all<{
            id: string;
            email: string;
            account_type: "owner" | "subaccount";
            status: "active" | "disabled";
            permissions: string | null;
            permissions_version: number;
          }>()
      ).results;
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        accountType: row.account_type,
        status: row.status,
        version: row.permissions_version,
        permissions:
          row.account_type === "owner"
            ? ADMIN_PERMISSIONS.map((permission) => permission.key)
            : (row.permissions ?? "").split(",").filter(isAdminPermission),
      }));
    },

    async setSubaccountPermissions(input: {
      ownerId: string;
      adminId: string;
      permissions: readonly AdminPermission[];
      commandId: string;
      expectedVersion: number;
      timestamp: string;
      auditIp: string | null;
    }) {
      const conflict = () =>
        new Response("权限已变更，请刷新后重试", { status: 409 });
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 0
      )
        throw new Response("Permission version required", { status: 400 });
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.commandId,
        )
      )
        throw new Response("Command id required", { status: 400 });
      const auditId = `admin-permissions:${input.commandId.toLowerCase()}`;
      const wanted = [...new Set(input.permissions)].sort();
      const replay = async () => {
        const prior = await db
          .prepare(
            `SELECT entity_id,actor_id,payload_json FROM admin_audit_events WHERE id=?`,
          )
          .bind(auditId)
          .first<{
            entity_id: string;
            actor_id: string;
            payload_json: string;
          }>();
        if (!prior) return false;
        const payload = JSON.parse(prior.payload_json) as {
          after: string[];
          expectedVersion: number;
        };
        if (
          prior.entity_id !== input.adminId ||
          prior.actor_id !== input.ownerId ||
          JSON.stringify([...payload.after].sort()) !==
            JSON.stringify(wanted) ||
          payload.expectedVersion !== input.expectedVersion
        )
          throw conflict();
        return true;
      };
      if (await replay()) return;
      const target = await db
        .prepare(
          `SELECT id,permissions_version,(SELECT group_concat(permission) FROM admin_identity_permissions
           WHERE admin_id=admin_identities.id) AS permissions
         FROM admin_identities WHERE id=? AND account_type='subaccount'`,
        )
        .bind(input.adminId)
        .first<{
          id: string;
          permissions_version: number;
          permissions: string | null;
        }>();
      if (!target) throw new Response("子账号不存在", { status: 404 });
      if (target.permissions_version !== input.expectedVersion)
        throw conflict();
      const before = (target.permissions ?? "")
        .split(",")
        .filter(isAdminPermission)
        .sort();
      const granted = wanted.filter((key) => !before.includes(key));
      const revoked = before.filter((key) => !wanted.includes(key));
      try {
        const results = await db.batch([
          db
            .prepare(
              `UPDATE admin_identities SET permissions_version=permissions_version+1
            WHERE id=? AND permissions_version=? AND account_type='subaccount'`,
            )
            .bind(target.id, input.expectedVersion),
          db.prepare(`INSERT INTO admin_permission_write_assertions(failed)
            SELECT 1 WHERE changes()!=1`),
          db
            .prepare(
              `INSERT INTO admin_audit_events
            (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
            VALUES (?,'admin.permissions_changed','admin_identity',?,?,?,?)`,
            )
            .bind(
              auditId,
              target.id,
              input.ownerId,
              JSON.stringify({
                before,
                after: wanted,
                granted,
                revoked,
                commandId: input.commandId,
                expectedVersion: input.expectedVersion,
                ipAddress: input.auditIp,
              }),
              input.timestamp,
            ),
          db
            .prepare(`DELETE FROM admin_identity_permissions WHERE admin_id=?`)
            .bind(target.id),
          ...wanted.map((permission) =>
            db
              .prepare(
                `INSERT INTO admin_identity_permissions
            (admin_id,permission,granted_by,granted_at) SELECT ?,?,?,?
            WHERE EXISTS(SELECT 1 FROM admin_audit_events WHERE id=?)`,
              )
              .bind(
                target.id,
                permission,
                input.ownerId,
                input.timestamp,
                auditId,
              ),
          ),
        ]);
        if (results[0].meta.changes !== 1 && !(await replay()))
          throw conflict();
      } catch (error) {
        if (await replay()) return;
        if (
          error instanceof Error &&
          error.message.includes("Concurrent permission change")
        )
          throw conflict();
        throw error;
      }
    },
  };
}
