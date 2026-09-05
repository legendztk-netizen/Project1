import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import {
  CatalogPublicationRejected,
  publishCatalogRelease,
  type CatalogPublicationPreview,
} from "../app/modules/catalog/domain/catalog-publication";
import { importCatalogWorkbook } from "../app/modules/catalog/domain/catalog-workbook-import";
import { createD1CatalogAssemblyImpactRepository } from "../app/modules/catalog/infrastructure/d1-catalog-assembly-impact-repository";
import { createD1CatalogAssemblyRegenerationRepository } from "../app/modules/catalog/infrastructure/d1-catalog-assembly-regeneration-repository";
import { createD1CatalogPublicationRepository } from "../app/modules/catalog/infrastructure/d1-catalog-publication-repository";
import { createD1CatalogWorkbookImportRepository } from "../app/modules/catalog/infrastructure/d1-catalog-workbook-import-repository";
import { createD1PublicCatalogRepository } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import { readCatalogWorkbook } from "../app/modules/catalog/infrastructure/read-catalog-workbook";
import { regenerateDerivedAssemblyData } from "../app/modules/catalog/domain/catalog-assembly-regeneration";
import { createD1ConfiguratorRepository } from "../app/modules/configurator/infrastructure/d1-configurator-repository";

const projectRoot = join(import.meta.dirname, "..");
const workbookPath = join(
  projectRoot,
  "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
);
const temporaryDirectories: string[] = [];
const auditContext = {
  ipAddress: "203.0.113.10",
  requestCorrelationId: "spec8-publication-test",
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function idGenerator(prefix: string) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

async function importDraft(
  database: D1Database,
  sheets: Awaited<ReturnType<typeof readCatalogWorkbook>>,
  prefix: string,
) {
  const result = await importCatalogWorkbook(
    createD1CatalogWorkbookImportRepository(database),
    {
      actorId: "owner-1",
      fileName: `${prefix}.xlsx`,
      fileSizeBytes: 1,
      generateId: idGenerator(prefix),
      now: () =>
        new Date(`2026-09-04T0${prefix === "first" ? "1" : "2"}:00:00.000Z`),
      sheets,
    },
  );
  if (!result.draftReleaseId) throw new Error("Expected a valid draft");
  await database.batch([
    database
      .prepare(
        `UPDATE catalog_skus
         SET catalog_publication_status = 'Published',
             rfq_eligibility = 'Eligible',
             supply_availability = 'available_for_quote'
         WHERE import_id = ?`,
      )
      .bind(result.id),
    database
      .prepare(
        `UPDATE catalog_sales_offers
         SET catalog_publication_status = 'Published',
             rfq_eligibility = 'Eligible'
         WHERE import_id = ?`,
      )
      .bind(result.id),
    database
      .prepare(
        `UPDATE catalog_compatibilities
         SET catalog_publication_status = 'Published',
             rfq_eligibility = 'Eligible'
         WHERE import_id = ?`,
      )
      .bind(result.id),
  ]);
  return { importId: result.id, releaseId: result.draftReleaseId };
}

async function previewOrThrow(
  database: D1Database,
  releaseId: string,
): Promise<CatalogPublicationPreview> {
  const preview =
    await createD1CatalogPublicationRepository(database).findPublicationPreview(
      releaseId,
    );
  if (!preview) throw new Error("Expected publication preview");
  return preview;
}

async function publishPreview(
  database: D1Database,
  preview: CatalogPublicationPreview,
  requestCorrelationId: string,
) {
  return publishCatalogRelease(createD1CatalogPublicationRepository(database), {
    actorId: "owner-1",
    expectedActiveGeneration: preview.activeGeneration,
    expectedActiveReleaseId: preview.activeRelease?.id ?? null,
    expectedAssemblyState: preview.assemblyState,
    expectedDraftVersion: preview.draftRelease.version,
    generateId: idGenerator(requestCorrelationId),
    ipAddress: "203.0.113.10",
    now: () => new Date("2026-09-04T03:00:00.000Z"),
    releaseId: preview.draftRelease.id,
    requestCorrelationId,
  });
}

describe("Spec 8 atomic product and Assembly Data publication", () => {
  it("publishes regenerated combinations, then publishes a price-only edit without regeneration", async () => {
    const directory = mkdtempSync(join(tmpdir(), "catalog-publication-spec8-"));
    temporaryDirectories.push(directory);
    const migration = spawnSync("pnpm", ["migrate"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, D1_PERSIST_TO: directory },
    });
    expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(
      0,
    );
    const platform = await getPlatformProxy<{ DB: D1Database }>({
      configPath: join(projectRoot, "wrangler.jsonc"),
      persist: { path: join(directory, "v3") },
      remoteBindings: false,
    });

    try {
      const database = platform.env.DB;
      const file = await readFile(workbookPath);
      const sheets = await readCatalogWorkbook(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      );
      const impactRepository =
        createD1CatalogAssemblyImpactRepository(database);
      const regenerationRepository =
        createD1CatalogAssemblyRegenerationRepository(database);

      const first = await importDraft(database, sheets, "first");
      const firstImpact = await impactRepository.recalculate({
        actorId: "owner-1",
        ...auditContext,
        releaseId: first.releaseId,
      });
      expect(firstImpact?.stale).toBe(true);
      await regenerateDerivedAssemblyData(regenerationRepository, {
        actorId: "owner-1",
        ...auditContext,
        generateId: () => "first-assembly-generation",
        releaseId: first.releaseId,
      });
      const firstPreview = await previewOrThrow(database, first.releaseId);
      expect(firstPreview.blockers).toEqual([]);
      expect(
        firstPreview.assemblyState.derivedCombinationCount,
      ).toBeGreaterThan(0);
      await publishPreview(database, firstPreview, "publish-first");
      const publicationRecord = await database
        .prepare(
          `SELECT summary_json FROM catalog_release_publications
           WHERE release_id = ?`,
        )
        .bind(first.releaseId)
        .first<{ summary_json: string }>();
      expect(
        JSON.parse(publicationRecord?.summary_json ?? "{}").differences,
      ).toEqual({
        affectedSeries: firstPreview.affectedSeries,
        derivedCombinations: firstPreview.derivedCombinations,
        images: firstPreview.images,
        prices: firstPreview.prices,
        products: firstPreview.products,
        relationships: firstPreview.relationships,
      });
      const publicationAudit = await database
        .prepare(
          `SELECT payload_json FROM admin_audit_events
           WHERE entity_id = ? AND event_type = 'catalog_release.published'`,
        )
        .bind(first.releaseId)
        .first<{ payload_json: string }>();
      expect(JSON.parse(publicationAudit?.payload_json ?? "{}")).toMatchObject({
        ipAddress: "203.0.113.10",
        requestCorrelationId: "publish-first",
      });

      const oldPrice = await database
        .prepare(
          `SELECT reference_price_usd FROM catalog_sales_offers
           WHERE import_id = ? AND base_sku = '601R1_001'`,
        )
        .bind(first.importId)
        .first<{ reference_price_usd: number }>();
      expect(oldPrice).toBeTruthy();

      const second = await importDraft(database, sheets, "second");
      const newPrice = (oldPrice?.reference_price_usd ?? 0) + 1;
      await database
        .prepare(
          `UPDATE catalog_sales_offers SET reference_price_usd = ?
           WHERE import_id = ? AND base_sku = '601R1_001'`,
        )
        .bind(newPrice, second.importId)
        .run();
      const priceOnlyImpact = await impactRepository.recalculate({
        actorId: "owner-1",
        ...auditContext,
        releaseId: second.releaseId,
      });
      expect(priceOnlyImpact).toMatchObject({
        affectedSeries: [],
        status: "current",
      });

      const secondPreview = await previewOrThrow(database, second.releaseId);
      expect(secondPreview.blockers).toEqual([]);
      expect(secondPreview.prices.changes).toContain("601R1_001");
      expect(secondPreview.images).toEqual({
        additions: [],
        changes: [],
        removals: [],
      });
      expect(secondPreview.derivedCombinations).toEqual({
        additions: [],
        changes: [],
        removals: [],
      });
      const published = await publishPreview(
        database,
        secondPreview,
        "publish-price-only",
      );
      expect(published.replayed).toBe(false);
      await expect(
        publishPreview(database, secondPreview, "publish-price-only"),
      ).resolves.toMatchObject({ replayed: true, releaseId: second.releaseId });

      const currentProduct =
        await createD1PublicCatalogRepository(database).findItem("601R1_001");
      expect(currentProduct?.offer?.referencePrice).toBe(newPrice);
      expect(
        await database
          .prepare(
            `SELECT reference_price_usd FROM catalog_sales_offers
             WHERE import_id = ? AND base_sku = '601R1_001'`,
          )
          .bind(first.importId)
          .first(),
      ).toEqual(oldPrice);

      const candidates = await createD1ConfiguratorRepository(
        database,
      ).findCompatibleEndA(second.releaseId, "601R1_002");
      expect(candidates.length).toBeGreaterThan(0);
      expect(
        await database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM catalog_derived_assembly_combinations
             WHERE release_id = ?`,
          )
          .bind(second.releaseId)
          .first<{ count: number }>(),
      ).toEqual({
        count: secondPreview.assemblyState.derivedCombinationCount,
      });
    } finally {
      await platform.dispose();
    }
  }, 120_000);

  it("blocks missing price, stale derivation, and stale-preview publication with rejection audit", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "catalog-publication-reject-"),
    );
    temporaryDirectories.push(directory);
    const migration = spawnSync("pnpm", ["migrate"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, D1_PERSIST_TO: directory },
    });
    expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(
      0,
    );
    const platform = await getPlatformProxy<{ DB: D1Database }>({
      configPath: join(projectRoot, "wrangler.jsonc"),
      persist: { path: join(directory, "v3") },
      remoteBindings: false,
    });

    try {
      const database = platform.env.DB;
      const file = await readFile(workbookPath);
      const sheets = await readCatalogWorkbook(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      );
      const draft = await importDraft(database, sheets, "first");
      const impacts = createD1CatalogAssemblyImpactRepository(database);
      const regenerations =
        createD1CatalogAssemblyRegenerationRepository(database);
      await impacts.recalculate({
        actorId: "owner-1",
        ...auditContext,
        releaseId: draft.releaseId,
      });
      await regenerateDerivedAssemblyData(regenerations, {
        actorId: "owner-1",
        ...auditContext,
        releaseId: draft.releaseId,
      });
      const reviewed = await previewOrThrow(database, draft.releaseId);
      expect(reviewed.blockers).toEqual([]);

      await database
        .prepare(
          `UPDATE catalog_sales_offers SET reference_price_usd = NULL
           WHERE import_id = ? AND base_sku = '601R1_001'`,
        )
        .bind(draft.importId)
        .run();
      const missingPrice = await previewOrThrow(database, draft.releaseId);
      expect(missingPrice.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "missing_reference_price" }),
        ]),
      );
      await expect(
        publishPreview(database, reviewed, "publish-stale-preview"),
      ).rejects.toBeInstanceOf(CatalogPublicationRejected);

      await database
        .prepare(
          `UPDATE catalog_sales_offers SET reference_price_usd = 2.16
           WHERE import_id = ? AND base_sku = '601R1_001'`,
        )
        .bind(draft.importId)
        .run();
      await database
        .prepare(
          `UPDATE catalog_compatibilities SET assembly_working_bar = 99
           WHERE import_id = ? AND compatibility_id = 'COMP_0011'`,
        )
        .bind(draft.importId)
        .run();
      await impacts.recalculate({
        actorId: "owner-1",
        ...auditContext,
        releaseId: draft.releaseId,
      });
      const stale = await previewOrThrow(database, draft.releaseId);
      expect(stale.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "stale_derived_assembly_data" }),
        ]),
      );
      expect(
        await database
          .prepare(
            `SELECT COUNT(*) AS count FROM admin_audit_events
             WHERE entity_id = ?
               AND event_type = 'catalog_release.publication_rejected'`,
          )
          .bind(draft.releaseId)
          .first<{ count: number }>(),
      ).toEqual({ count: 1 });
      const rejectionAudit = await database
        .prepare(
          `SELECT payload_json FROM admin_audit_events
           WHERE entity_id = ?
             AND event_type = 'catalog_release.publication_rejected'`,
        )
        .bind(draft.releaseId)
        .first<{ payload_json: string }>();
      expect(JSON.parse(rejectionAudit?.payload_json ?? "{}")).toMatchObject({
        ipAddress: "203.0.113.10",
        requestCorrelationId: "publish-stale-preview",
      });
      expect(
        await database
          .prepare(
            `SELECT release_id FROM catalog_active_release WHERE singleton = 1`,
          )
          .first(),
      ).toEqual({ release_id: null });
    } finally {
      await platform.dispose();
    }
  }, 120_000);
});
