import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const adminIdentities = sqliteTable(
  "admin_identities",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    accountType: text("account_type").notNull(),
    status: text("status").notNull(),
    canManageSubaccounts: integer("can_manage_subaccounts", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "admin_identity_account_type",
      sql`${table.accountType} in ('owner', 'subaccount')`,
    ),
    check(
      "admin_identity_email_lowercase",
      sql`${table.email} = lower(${table.email})`,
    ),
    check(
      "admin_identity_status",
      sql`${table.status} in ('active', 'disabled')`,
    ),
    uniqueIndex("admin_identities_email_uq").on(table.email),
  ],
);
