import type { ModuleAccess } from "../domain/admin-module-access";
import {
  isAdminPermission,
  type AdminPermission,
} from "../domain/admin-permissions";

export interface ActiveAdminIdentityRecord {
  moduleAccess?: ModuleAccess;
  catalogPermission?: "view" | "edit";
  permissions?: AdminPermission[];
  accountType: "owner" | "subaccount";
  canManageSubaccounts: boolean;
  email: string;
  id: string;
}

interface AdminIdentityRow {
  module_access: string | null;
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
         (SELECT json_group_object(module,level) FROM admin_module_permissions m WHERE m.admin_id=admin_identities.id) AS module_access,
         (SELECT group_concat(permission) FROM admin_identity_permissions p
           WHERE p.admin_id = admin_identities.id) AS permissions
       FROM admin_identities
       WHERE email = ? AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(email)
    .first<AdminIdentityRow>();

  if (!row) return null;
  return {
    moduleAccess: JSON.parse(row.module_access ?? "{}") as ModuleAccess,
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
