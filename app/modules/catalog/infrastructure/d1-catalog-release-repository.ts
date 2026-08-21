import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  type CatalogReleaseRepository,
  type CreateDiagnosticDraftOperation,
  type DiagnosticCatalogRelease,
} from "../domain/catalog-release";
import {
  adminAuditEvents,
  catalogImports,
  catalogReleases,
} from "./database-schema";

function toDiagnosticRelease(
  row: typeof catalogReleases.$inferSelect | undefined,
): DiagnosticCatalogRelease | null {
  if (!row || row.status !== "draft" || row.publishedAt !== null) return null;
  return {
    createdAt: row.createdAt,
    id: row.id,
    publishedAt: null,
    releaseNumber: row.releaseNumber,
    releaseVersion: row.version,
    sourceImportId: row.sourceImportId,
    status: "draft",
  };
}

export function createD1CatalogReleaseRepository(
  database: D1Database,
): CatalogReleaseRepository {
  const db = drizzle(database);

  return {
    async createDiagnosticDraft({
      actorId,
      auditEventId,
      release,
    }: CreateDiagnosticDraftOperation) {
      await db.batch([
        db.insert(catalogImports).values({
          completedAt: release.createdAt,
          createdAt: release.createdAt,
          id: release.sourceImportId,
          kind: "diagnostic",
          sourceFileName: null,
          status: "completed",
        }),
        db.insert(catalogReleases).values({
          createdAt: release.createdAt,
          id: release.id,
          publishedAt: release.publishedAt,
          releaseNumber: release.releaseNumber,
          sourceImportId: release.sourceImportId,
          status: release.status,
          version: release.releaseVersion,
        }),
        db.insert(adminAuditEvents).values({
          actorId,
          entityId: release.id,
          entityType: "catalog_release",
          eventType: "catalog_release.diagnostic_created",
          id: auditEventId,
          occurredAt: release.createdAt,
          payloadJson: JSON.stringify({ releaseNumber: release.releaseNumber }),
        }),
      ]);
    },

    async findDiagnosticDraftById(id) {
      const rows = await db
        .select()
        .from(catalogReleases)
        .innerJoin(catalogImports, eq(catalogReleases.sourceImportId, catalogImports.id))
        .where(
          and(
            eq(catalogReleases.id, id),
            eq(catalogReleases.status, "draft"),
            eq(catalogImports.kind, "diagnostic"),
          ),
        )
        .limit(1);
      return toDiagnosticRelease(rows[0]?.catalog_releases);
    },

    async findLatestDiagnosticDraft() {
      const rows = await db
        .select()
        .from(catalogReleases)
        .innerJoin(catalogImports, eq(catalogReleases.sourceImportId, catalogImports.id))
        .where(
          and(
            eq(catalogReleases.status, "draft"),
            eq(catalogImports.kind, "diagnostic"),
          ),
        )
        .orderBy(desc(catalogReleases.createdAt))
        .limit(1);
      return toDiagnosticRelease(rows[0]?.catalog_releases);
    },
  };
}
