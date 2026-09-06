import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import {
  AssemblyRegenerationRejected,
  regenerateDerivedAssemblyData,
  type AssemblyRegenerationRepository,
} from "../app/modules/catalog/domain/catalog-assembly-regeneration";
import { createD1CatalogAssemblyImpactRepository } from "../app/modules/catalog/infrastructure/d1-catalog-assembly-impact-repository";
import { createD1CatalogAssemblyRegenerationRepository } from "../app/modules/catalog/infrastructure/d1-catalog-assembly-regeneration-repository";

const auditContext = {
  ipAddress: "203.0.113.10",
  requestCorrelationId: "assembly-regeneration-test",
};

const projectRoot = join(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

async function seedCatalog(database: D1Database, name: "active" | "draft") {
  const importId = `${name}-import`;
  const releaseId = `${name}-release`;
  const productRows = [
    ["HOSE-A", "hose", "SERIES-A"],
    ["HOSE-B", "hose", "SERIES-B"],
    ["END-1", "hose_end", null],
    ["END-2", "hose_end", null],
    ["FERRULE-1", "ferrule", null],
    ["FERRULE-2", "ferrule", null],
  ] as const;
  await database.batch([
    database.prepare(
      `INSERT INTO catalog_imports (
         id, kind, status, source_file_name, source_file_size_bytes,
         summary_json, error_count, warning_count, created_at, completed_at
       ) VALUES ('${importId}', 'workbook', 'completed', '${name}.xlsx', 1,
                 '{}', 0, 0, '2026-09-04T00:00:00.000Z',
                 '2026-09-04T00:00:00.000Z')`,
    ),
    database.prepare(
      `INSERT OR IGNORE INTO catalog_media_lineages
         (id, logical_reference, created_at, created_by)
       VALUES ('fixture-lineage', 'fixture-series-image', '2026-09-04', 'test')`,
    ),
    database.prepare(
      `INSERT OR IGNORE INTO catalog_media_versions
         (id, lineage_id, version, source_kind, approved_reference, mime_type,
          created_at, created_by)
       VALUES ('fixture-media', 'fixture-lineage', 1, 'approved_reference',
               'fixture-series-image', 'reference', '2026-09-04', 'test')`,
    ),
    ...["SERIES-A", "SERIES-B"].map((series) =>
      database.prepare(
        `INSERT INTO catalog_hose_series
           (id, import_id, series_code, series_name, primary_standard,
            equivalent_standard, temp_min_c, temp_max_c,
            representative_media_version_id)
         VALUES ('${name}-${series}', '${importId}', '${series}', '${series}',
                 'SAE 100R2', 'N/A', -40, 100, 'fixture-media')`,
      ),
    ),
    ...["END-1", "END-2"].map((series) =>
      database.prepare(
        `INSERT INTO catalog_hose_end_series
           (id, import_id, series_code, series_name, interface_family,
            connection_standard, gender, swivel_form, angle, sealing_form,
            representative_media_version_id)
         VALUES ('${name}-${series}-series', '${importId}', '${series}', '${series}',
                 'JIC', 'SAE J514', 'female', 'swivel', 'straight',
                 '37-degree flare', 'fixture-media')`,
      ),
    ),
    ...productRows.map(([sku, productType, series]) =>
      database
        .prepare(
          `INSERT INTO catalog_skus (
             id, import_id, sku, source_worksheet, product_type, hose_series,
             catalog_publication_status, rfq_eligibility,
             technical_data_status, supply_availability
           ) VALUES (?, ?, ?, 'fixture', ?, ?, 'Published', 'Eligible',
                     'Complete', 'available_for_quote')`,
        )
        .bind(`${name}-${sku}`, importId, sku, productType, series),
    ),
    ...["HOSE-A", "HOSE-B"].map((sku) =>
      database
        .prepare(
          `INSERT INTO catalog_hose_variants (
             id, import_id, sku, hose_series, primary_standard, dash,
             nominal_id_in, id_mm, od_mm, working_bar, burst_bar,
             bend_radius_mm, weight_kg_m, temp_min_c, temp_max_c,
             tube_material, reinforcement, cover_material, cover_color,
             skive_requirement, fluid_compatibility, origin, source
           ) VALUES (?, ?, ?, ?, 'SAE 100R2', '-08', 0.5, 12.7, 21, 250,
                     1000, 180, 0.5, -40, 100, 'NBR', '2-wire', 'NBR',
                     'black', 'no_skive', 'oil', 'CN', 'fixture')`,
        )
        .bind(
          `${name}-detail-${sku}`,
          importId,
          sku,
          sku === "HOSE-A" ? "SERIES-A" : "SERIES-B",
        ),
    ),
    ...["END-1", "END-2"].map((sku) =>
      database
        .prepare(
          `INSERT INTO catalog_hose_ends (
             id, import_id, sku, fitting_series, interface_family,
             connection_standard, gender, swivel_form, angle, sealing_form,
             thread, connection_dash, hose_tail_dash, source
           ) VALUES (?, ?, ?, ?, 'JIC', 'SAE J514', 'female', 'swivel',
                     'straight', '37-degree flare', 'UNF', '-08', '-08',
                     'fixture')`,
        )
        .bind(`${name}-detail-${sku}`, importId, sku, sku),
    ),
    ...["FERRULE-1", "FERRULE-2"].map((sku) =>
      database
        .prepare(
          `INSERT INTO catalog_ferrules (
             id, import_id, sku, ferrule_series, hose_construction,
             hose_tail_dash, skive_requirement, material, coating, source
           ) VALUES (?, ?, ?, ?, '2-wire', '-08', 'no_skive', 'steel',
                     'zinc', 'fixture')`,
        )
        .bind(`${name}-detail-${sku}`, importId, sku, sku),
    ),
    ...[
      ["COMP-A1", "HOSE-A", "END-1", "FERRULE-1"],
      ["COMP-A2", "HOSE-A", "END-2", "FERRULE-2"],
      ["COMP-B1", "HOSE-B", "END-1", "FERRULE-1"],
    ].map(([compatibilityId, hoseSku, hoseEndSku, ferruleSku]) =>
      database
        .prepare(
          `INSERT INTO catalog_compatibilities (
             id, import_id, compatibility_id, hose_sku, hose_end_sku,
             ferrule_sku, assembly_working_bar, qualification_status,
             rfq_eligibility, technical_data_status,
             production_approval_status, catalog_publication_status
           ) VALUES (?, ?, ?, ?, ?, ?, 100, 'Approved', 'Eligible',
                     'Complete', 'approved', 'Published')`,
        )
        .bind(
          `${name}-${compatibilityId}`,
          importId,
          compatibilityId,
          hoseSku,
          hoseEndSku,
          ferruleSku,
        ),
    ),
    database.prepare(
      `INSERT INTO catalog_releases (
         id, release_number, status, source_import_id, version, created_at
       ) VALUES ('${releaseId}', '${name.toUpperCase()}', 'draft', '${importId}',
                 1, '${name === "active" ? "2026-09-04T00:00:00.000Z" : "2026-09-04T01:00:00.000Z"}')`,
    ),
  ]);
  return { importId, releaseId };
}

describe("D1 Derived Assembly Data regeneration", () => {
  it("replaces affected series, carries unchanged series, is idempotent, and rolls back a failed run", async () => {
    const directory = mkdtempSync(join(tmpdir(), "assembly-regeneration-d1-"));
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
      const active = await seedCatalog(database, "active");
      const impacts = createD1CatalogAssemblyImpactRepository(database);
      const regenerations =
        createD1CatalogAssemblyRegenerationRepository(database);
      await impacts.recalculate({
        actorId: "owner-1",
        ...auditContext,
        releaseId: active.releaseId,
      });
      const initial = await regenerateDerivedAssemblyData(regenerations, {
        actorId: "owner-1",
        ...auditContext,
        generateId: () => "generation-initial",
        now: () => new Date("2026-09-04T00:30:00.000Z"),
        releaseId: active.releaseId,
      });
      expect(initial).toMatchObject({
        affectedSeries: ["SERIES-A", "SERIES-B"],
        combinationCount: 5,
        status: "succeeded",
      });
      await database.batch([
        database.prepare(
          `UPDATE catalog_releases
           SET status = 'published', version = version + 1,
               published_at = '2026-09-04T00:45:00.000Z'
           WHERE id = 'active-release'`,
        ),
        database.prepare(
          `UPDATE catalog_active_release
           SET release_id = 'active-release', version = 1,
               updated_at = '2026-09-04T00:45:00.000Z'
           WHERE singleton = 1`,
        ),
      ]);

      const draft = await seedCatalog(database, "draft");
      await database
        .prepare(
          `UPDATE catalog_compatibilities SET assembly_working_bar = 90
           WHERE import_id = 'draft-import' AND compatibility_id = 'COMP-A2'`,
        )
        .run();
      const impact = await impacts.recalculate({
        actorId: "owner-1",
        ...auditContext,
        releaseId: draft.releaseId,
      });
      expect(impact?.affectedSeries).toEqual(["SERIES-A"]);

      const changed = await regenerateDerivedAssemblyData(regenerations, {
        actorId: "owner-1",
        ...auditContext,
        generateId: () => "generation-changed",
        now: () => new Date("2026-09-04T02:00:00.000Z"),
        releaseId: draft.releaseId,
      });
      expect(changed).toMatchObject({
        additionCount: 0,
        affectedSeries: ["SERIES-A"],
        changeCount: 3,
        combinationCount: 4,
        removalCount: 0,
      });
      expect(
        await database
          .prepare(
            `SELECT hose_series, generation_id, combination_count
             FROM catalog_derived_assembly_series
             WHERE release_id = 'draft-release' ORDER BY hose_series`,
          )
          .all(),
      ).toMatchObject({
        results: [
          {
            combination_count: 4,
            generation_id: "generation-changed",
            hose_series: "SERIES-A",
          },
          {
            combination_count: 1,
            generation_id: "generation-initial",
            hose_series: "SERIES-B",
          },
        ],
      });
      await expect(
        database
          .prepare(
            `INSERT INTO catalog_derived_assembly_combinations (
               id, release_id, source_import_id, hose_series, hose_sku,
               end_a_compatibility_id, end_a_hose_end_sku, end_a_ferrule_sku,
               end_b_compatibility_id, end_b_hose_end_sku, end_b_ferrule_sku,
               end_a_relationship_fingerprint, end_b_relationship_fingerprint,
               combination_fingerprint, generated_at
             )
             SELECT 'cross-version', 'draft-release', 'active-import',
                    hose_series, hose_sku, end_a_compatibility_id,
                    end_a_hose_end_sku, end_a_ferrule_sku,
                    end_b_compatibility_id, end_b_hose_end_sku,
                    end_b_ferrule_sku, end_a_relationship_fingerprint,
                    end_b_relationship_fingerprint, combination_fingerprint,
                    generated_at
             FROM catalog_derived_assembly_combinations
             WHERE release_id = 'active-release' LIMIT 1`,
          )
          .run(),
      ).rejects.toThrow(/invalid or cross-version provenance/u);

      await database
        .prepare(
          `DELETE FROM catalog_compatibilities
           WHERE import_id = 'draft-import' AND compatibility_id = 'COMP-A2'`,
        )
        .run();
      await impacts.recalculate({
        actorId: "owner-1",
        ...auditContext,
        releaseId: draft.releaseId,
      });
      const removed = await regenerateDerivedAssemblyData(regenerations, {
        actorId: "owner-1",
        ...auditContext,
        generateId: () => "generation-removed",
        releaseId: draft.releaseId,
      });
      expect(removed).toMatchObject({
        additionCount: 0,
        combinationCount: 1,
        removalCount: 3,
      });
      await expect(
        regenerateDerivedAssemblyData(regenerations, {
          actorId: "owner-1",
          ...auditContext,
          generateId: () => "generation-repeat",
          releaseId: draft.releaseId,
        }),
      ).resolves.toMatchObject({ status: "already_current" });

      await database.batch([
        database.prepare(
          `INSERT INTO catalog_hose_end_series
             (id, import_id, series_code, series_name, interface_family,
              connection_standard, gender, swivel_form, angle, sealing_form,
              representative_media_version_id)
           VALUES ('draft-display-series', 'draft-import', 'DISPLAY-ONLY',
                   'Display only', 'JIC', 'SAE J514', 'female', 'swivel',
                   'straight', '37-degree flare', 'fixture-media')`,
        ),
        database.prepare(
          `UPDATE catalog_hose_ends SET fitting_series = 'DISPLAY-ONLY'
           WHERE import_id = 'draft-import' AND sku = 'END-1'`,
        ),
      ]);
      await expect(
        impacts.recalculate({
          actorId: "owner-1",
          ...auditContext,
          releaseId: draft.releaseId,
        }),
      ).resolves.toMatchObject({ status: "current" });

      await database
        .prepare(
          `UPDATE catalog_compatibilities SET assembly_working_bar = 80
           WHERE import_id = 'draft-import' AND compatibility_id = 'COMP-A1'`,
        )
        .run();
      await impacts.recalculate({
        actorId: "owner-1",
        ...auditContext,
        releaseId: draft.releaseId,
      });
      const racingRepository: AssemblyRegenerationRepository = {
        ...regenerations,
        async regenerate(operation) {
          await database
            .prepare(
              `INSERT INTO catalog_compatibilities (
                 id, import_id, compatibility_id, hose_sku, hose_end_sku,
                 ferrule_sku, assembly_working_bar, qualification_status,
                 rfq_eligibility, technical_data_status,
                 production_approval_status, catalog_publication_status
               ) VALUES ('draft-COMP-B2', 'draft-import', 'COMP-B2',
                         'HOSE-B', 'END-2', 'FERRULE-2', 100, 'Approved',
                         'Eligible', 'Complete', 'approved', 'Published')`,
            )
            .run();
          await regenerations.regenerate(operation);
        },
      };
      await expect(
        regenerateDerivedAssemblyData(racingRepository, {
          actorId: "owner-1",
          ...auditContext,
          generateId: () => "generation-failed",
          releaseId: draft.releaseId,
        }),
      ).rejects.toBeInstanceOf(AssemblyRegenerationRejected);
      expect(
        await database
          .prepare(
            `SELECT status FROM catalog_assembly_regenerations
             WHERE id = 'generation-failed'`,
          )
          .first(),
      ).toEqual({ status: "failed" });
      expect(
        await database
          .prepare(
            `SELECT id, status FROM catalog_releases
             WHERE id IN ('active-release', 'draft-release') ORDER BY id`,
          )
          .all(),
      ).toMatchObject({
        results: [
          { id: "active-release", status: "published" },
          { id: "draft-release", status: "draft" },
        ],
      });
      expect(
        await database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM catalog_derived_assembly_combinations
             WHERE release_id = 'draft-release' AND hose_series = 'SERIES-A'`,
          )
          .first(),
      ).toEqual({ count: 1 });
      expect(
        await database
          .prepare(
            `SELECT event_type
             FROM admin_audit_events
             WHERE event_type LIKE 'catalog_release.assembly_regeneration%'
                OR event_type = 'catalog_release.assembly_regenerated'
             ORDER BY occurred_at, event_type`,
          )
          .all(),
      ).toMatchObject({
        results: expect.arrayContaining([
          { event_type: "catalog_release.assembly_regenerated" },
          {
            event_type: "catalog_release.assembly_regeneration_already_current",
          },
          { event_type: "catalog_release.assembly_regeneration_failed" },
        ]),
      });
      const regenerationAudit = await database
        .prepare(
          `SELECT payload_json FROM admin_audit_events
           WHERE event_type = 'catalog_release.assembly_regenerated'
           ORDER BY occurred_at DESC LIMIT 1`,
        )
        .first<{ payload_json: string }>();
      expect(JSON.parse(regenerationAudit?.payload_json ?? "{}")).toMatchObject(
        {
          ...auditContext,
          after: expect.objectContaining({
            combinationCount: expect.any(Number),
            combinationIdentitySample: expect.any(Array),
            generationId: expect.any(String),
            inputFingerprint: expect.any(String),
          }),
          before: expect.objectContaining({
            combinationCount: expect.any(Number),
            combinationIdentitySample: expect.any(Array),
          }),
        },
      );
    } finally {
      await platform.dispose();
    }
  }, 90_000);
});
