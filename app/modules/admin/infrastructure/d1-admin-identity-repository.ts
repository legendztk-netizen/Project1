export interface ActiveAdminIdentityRecord {
  accountType: "owner" | "subaccount";
  canManageSubaccounts: boolean;
  email: string;
  id: string;
}

interface AdminIdentityRow {
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
      `SELECT id, email, account_type
       FROM admin_identities
       WHERE email = ? AND status = 'active'
       LIMIT 1`,
    )
    .bind(email)
    .first<AdminIdentityRow>();

  if (!row) return null;
  return {
    accountType: row.account_type,
    canManageSubaccounts: row.account_type === "owner",
    email: row.email,
    id: row.id,
  };
}
