import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const applicationSchemaState = sqliteTable("application_schema_state", {
  singleton: integer("singleton").primaryKey(),
  version: integer("version").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const catalogImports = sqliteTable(
  "catalog_imports",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    sourceFileName: text("source_file_name"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    check("catalog_import_kind", sql`${table.kind} in ('diagnostic', 'workbook')`),
    check(
      "catalog_import_status",
      sql`${table.status} in ('pending', 'completed', 'failed')`,
    ),
    index("catalog_imports_created_at_idx").on(table.createdAt),
  ],
);

export const catalogReleases = sqliteTable(
  "catalog_releases",
  {
    id: text("id").primaryKey(),
    releaseNumber: text("release_number").notNull(),
    status: text("status").notNull(),
    sourceImportId: text("source_import_id")
      .notNull()
      .references(() => catalogImports.id),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    check(
      "catalog_release_status",
      sql`${table.status} in ('draft', 'published', 'superseded')`,
    ),
    uniqueIndex("catalog_releases_release_number_uq").on(table.releaseNumber),
    index("catalog_releases_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

export const adminAuditEvents = sqliteTable(
  "admin_audit_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actorId: text("actor_id").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    index("admin_audit_events_entity_idx").on(table.entityType, table.entityId),
    index("admin_audit_events_occurred_at_idx").on(table.occurredAt),
  ],
);
