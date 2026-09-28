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
            `SELECT i.id,i.email,i.account_type,i.status,
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
          }>()
      ).results;
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        accountType: row.account_type,
        status: row.status,
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
      timestamp: string;
      auditIp: string | null;
    }) {
      const auditId = `admin-permissions:${input.commandId}`;
      if (
        await db
          .prepare(`SELECT 1 FROM admin_audit_events WHERE id=?`)
          .bind(auditId)
          .first()
      )
        return;
      const target = await db
        .prepare(
          `SELECT id,(SELECT group_concat(permission) FROM admin_identity_permissions
             WHERE admin_id=admin_identities.id) AS permissions
           FROM admin_identities WHERE id=? AND account_type='subaccount'`,
        )
        .bind(input.adminId)
        .first<{ id: string; permissions: string | null }>();
      if (!target) throw new Response("子账号不存在", { status: 404 });
      const before = (target.permissions ?? "")
        .split(",")
        .filter(isAdminPermission);
      const wanted = new Set(input.permissions);
      const granted = [...wanted].filter((key) => !before.includes(key));
      const revoked = before.filter((key) => !wanted.has(key));
      await db.batch([
        ...revoked.map((permission) =>
          db
            .prepare(
              `DELETE FROM admin_identity_permissions WHERE admin_id=? AND permission=?`,
            )
            .bind(target.id, permission),
        ),
        ...granted.map((permission) =>
          db
            .prepare(
              `INSERT INTO admin_identity_permissions(admin_id,permission,granted_by,granted_at)
               VALUES (?,?,?,?) ON CONFLICT(admin_id,permission) DO NOTHING`,
            )
            .bind(target.id, permission, input.ownerId, input.timestamp),
        ),
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
              after: [...wanted],
              granted,
              revoked,
              commandId: input.commandId,
              ipAddress: input.auditIp,
            }),
            input.timestamp,
          ),
      ]);
    },
  };
}
