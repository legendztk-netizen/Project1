import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { catalogReleases } from "../../catalog/infrastructure/database-schema";

export const quoteReferenceDiscounts = sqliteTable(
  "quote_reference_discounts",
  {
    releaseId: text("release_id")
      .notNull()
      .references(() => catalogReleases.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    lineKind: text("line_kind").notNull(),
    minimumQuantity: integer("minimum_quantity").notNull(),
    discountPercent: real("discount_percent").notNull(),
    recordVersion: integer("record_version").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.releaseId,
        table.sku,
        table.lineKind,
        table.minimumQuantity,
      ],
    }),
    check(
      "quote_reference_discount_line_kind",
      sql`${table.lineKind} in ('standard', 'length_based_hose', 'configured_assembly')`,
    ),
    check(
      "quote_reference_discount_minimum_quantity",
      sql`${table.minimumQuantity} between 1 and 9999`,
    ),
    check(
      "quote_reference_discount_percent",
      sql`${table.discountPercent} >= 0 and ${table.discountPercent} <= 100`,
    ),
    check("quote_reference_discount_version", sql`${table.recordVersion} >= 1`),
    index("quote_reference_discounts_lookup_idx").on(
      table.releaseId,
      table.sku,
      table.lineKind,
      table.minimumQuantity,
    ),
  ],
);
