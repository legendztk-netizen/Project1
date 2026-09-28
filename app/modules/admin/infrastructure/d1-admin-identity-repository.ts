import {
  isAdminPermission,
  type AdminPermission,
} from "../domain/admin-permissions";

export interface ActiveAdminIdentityRecord {
  catalogPermission?: "view" | "edit";
  permissions?: AdminPermission[];
  accountType: "owner" | "subaccount";
  canManageSubaccounts: boolean;
  email: string;
  id: string;
}

interface AdminIdentityRow {
  catalog_permission: "view" | "edit";
  permissions: string | null;
  account_type: "owner" | "subaccount";
  email: string;
  id: string;
}

export async function findActiveAdminIdentityByEmail(
  database: D1Database,
  email: string,
): Promise<ActiveAdminIdentityRecord | null> {
  const row = await database
    .prepare(
      `SELECT id, email, account_type, catalog_permission,
         (SELECT group_concat(permission) FROM admin_identity_permissions p
           WHERE p.admin_id = admin_identities.id) AS permissions
       FROM admin_identities
       WHERE email = ? AND status = 'active'
       LIMIT 1`,
    )
    .bind(email)
    .first<AdminIdentityRow>();

  if (!row) return null;
  return {
    ...(row.catalog_permission === "view"
      ? { catalogPermission: "view" as const }
      : {}),
    ...(row.permissions
      ? {
          permissions: row.permissions.split(",").filter(isAdminPermission),
        }
      : {}),
    accountType: row.account_type,
    canManageSubaccounts: row.account_type === "owner",
    email: row.email,
    id: row.id,
  };
}
