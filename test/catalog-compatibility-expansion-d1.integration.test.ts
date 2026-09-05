import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import { expandDraftCatalogCompatibilities } from "../app/modules/catalog/infrastructure/d1-catalog-compatibility-expansion-repository";

const projectRoot = join(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function product(
  database: D1Database,
  importId: string,
  sku: string,
  type: "ferrule" | "hose" | "hose_end",
  series: string | null,
  lifecycle: {
    publication?: "Archived" | "Draft" | "Published";
    rfq?: "Blocked" | "Eligible" | "Manual Quote Only";
    supply?: "available_for_quote" | "discontinued" | "temporarily_unavailable";
  } = {},
) {
  return database
    .prepare(
      `INSERT INTO catalog_skus (
         id, import_id, sku, source_worksheet, product_type, hose_series,
         catalog_publication_status, rfq_eligibility,
         technical_data_status, supply_availability
       ) VALUES (?, ?, ?, 'fixture', ?, ?, ?, ?, 'Complete', ?)`,
    )
    .bind(
      `${importId}:${sku}`,
      importId,
      sku,
      type,
      series,
      lifecycle.publication ?? "Published",
      lifecycle.rfq ?? "Eligible",
      lifecycle.supply ?? "available_for_quote",
    );
}

function hoseSeries(database: D1Database, importId: string, series: string) {
  return database.prepare(
    `INSERT INTO catalog_hose_series
       (id, import_id, series_code, series_name, primary_standard,
        equivalent_standard, temp_min_c, temp_max_c,
        representative_media_version_id)
     VALUES ('${importId}:${series}', '${importId}', '${series}', '${series}',
             'SAE', 'N/A', -40, 100, 'fixture-media')`,
  );
}

function hoseEndSeries(database: D1Database, importId: string) {
  return database.prepare(
    `INSERT INTO catalog_hose_end_series
       (id, import_id, series_code, series_name, interface_family,
        connection_standard, gender, swivel_form, angle, sealing_form,
        representative_media_version_id)
     VALUES ('${importId}:END', '${importId}', 'END', 'END', 'JIC',
             'SAE J514', 'Female', 'Swivel', 'Straight', 'Cone', 'fixture-media')`,
  );
}

function hose(
  database: D1Database,
  importId: string,
  sku: string,
  series: string,
  dash: string,
  skiveRequirement = "No Skive",
) {
  return database
    .prepare(
      `INSERT INTO catalog_hose_variants (
         id, import_id, sku, hose_series, primary_standard, dash,
         nominal_id_in, id_mm, od_mm, working_bar, burst_bar,
         bend_radius_mm, weight_kg_m, temp_min_c, temp_max_c, tube_material,
         reinforcement, cover_material, cover_color, skive_requirement,
         fluid_compatibility, origin, source
       ) VALUES (?, ?, ?, ?, 'SAE', ?, 0.25, 6.4, 12, 200, 800, 100,
                 0.3, -40, 100, 'NBR', 'Wire', 'Rubber', 'Black',
                 ?, 'Oil', 'CN', 'fixture')`,
    )
    .bind(
      `${importId}:hose:${sku}`,
      importId,
      sku,
      series,
      dash,
      skiveRequirement,
    );
}

function hoseEnd(
  database: D1Database,
  importId: string,
  sku: string,
  dash: string,
) {
  return database
    .prepare(
      `INSERT INTO catalog_hose_ends (
         id, import_id, sku, fitting_series, interface_family,
         connection_standard, gender, swivel_form, angle, sealing_form,
         thread, connection_dash, hose_tail_dash, source
       ) VALUES (?, ?, ?, 'END', 'JIC', 'SAE J514', 'Female', 'Swivel',
                 'Straight', 'Cone', '7/16-20', ?, ?, 'fixture')`,
    )
    .bind(`${importId}:end:${sku}`, importId, sku, dash, dash);
}

function ferrule(
  database: D1Database,
  importId: string,
  sku: string,
  series: string,
  dash: string,
  skiveRequirement = "No Skive",
) {
  return database
    .prepare(
      `INSERT INTO catalog_ferrules (
         id, import_id, sku, ferrule_series, hose_construction,
         hose_tail_dash, skive_requirement, material, coating, source
       ) VALUES (?, ?, ?, ?, 'Wire', ?, ?, 'Steel', 'Zinc',
                 'fixture')`,
    )
    .bind(
      `${importId}:ferrule:${sku}`,
      importId,
      sku,
      series,
      dash,
      skiveRequirement,
    );
}

function relationship(
  database: D1Database,
  importId: string,
  id: string,
  hoseSku: string,
  endSku: string,
  ferruleSku: string,
) {
  return database
    .prepare(
      `INSERT INTO catalog_compatibilities (
         id, import_id, compatibility_id, hose_sku, hose_end_sku,
         ferrule_sku, qualification_status, rfq_eligibility,
         technical_data_status, production_approval_status,
         catalog_publication_status
       ) VALUES (?, ?, ?, ?, ?, ?, 'Not Tested', 'Eligible', 'Pending',
                 'not_approved', 'Published')`,
    )
    .bind(`${importId}:${id}`, importId, id, hoseSku, endSku, ferruleSku);
}

describe("automatic Catalog compatibility expansion", () => {
  it("expands new Hose and Hose End products by controlled keys without touching an unrelated Dash", async () => {
    const directory = mkdtempSync(join(tmpdir(), "compatibility-expansion-"));
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
      await database.batch([
        ...["active", "draft"].map((name) =>
          database.prepare(
            `INSERT INTO catalog_imports (
               id, kind, status, source_file_name, source_file_size_bytes,
               summary_json, error_count, warning_count, created_at, completed_at
             ) VALUES ('${name}-import', 'workbook', 'completed', '${name}.xlsx',
                       1, '{}', 0, 0, '2026-09-05T00:00:00.000Z',
                       '2026-09-05T00:00:00.000Z')`,
          ),
        ),
        database.prepare(
          `INSERT INTO catalog_media_lineages
             (id, logical_reference, created_at, created_by)
           VALUES ('fixture-lineage', 'fixture-series-image', '2026-09-05', 'test')`,
        ),
        database.prepare(
          `INSERT INTO catalog_media_versions
             (id, lineage_id, version, source_kind, approved_reference, mime_type,
              created_at, created_by)
           VALUES ('fixture-media', 'fixture-lineage', 1, 'approved_reference',
                   'fixture-series-image', 'reference', '2026-09-05', 'test')`,
        ),
        ...["active-import", "draft-import"].flatMap((importId) => [
          hoseSeries(database, importId, "601R1"),
          hoseSeries(database, importId, "701R1"),
          hoseEndSeries(database, importId),
          product(database, importId, "HOSE-04", "hose", "601R1"),
          hose(database, importId, "HOSE-04", "601R1", "-4"),
          product(database, importId, "HOSE-06", "hose", "701R1"),
          hose(database, importId, "HOSE-06", "701R1", "-6"),
          product(database, importId, "END-04", "hose_end", null),
          hoseEnd(database, importId, "END-04", "-4"),
          product(database, importId, "END-06", "hose_end", null),
          hoseEnd(database, importId, "END-06", "-6"),
          product(database, importId, "FERRULE-04", "ferrule", null),
          ferrule(database, importId, "FERRULE-04", "601R1", "-4"),
          product(database, importId, "FERRULE-06", "ferrule", null),
          ferrule(database, importId, "FERRULE-06", "701R1", "-6"),
          relationship(
            database,
            importId,
            "REL-04",
            "HOSE-04",
            "END-04",
            "FERRULE-04",
          ),
          relationship(
            database,
            importId,
            "REL-06",
            "HOSE-06",
            "END-06",
            "FERRULE-06",
          ),
        ]),
        product(database, "draft-import", "END-NEW-04", "hose_end", null),
        hoseEnd(database, "draft-import", "END-NEW-04", "-4"),
        product(database, "draft-import", "HOSE-NEW-04", "hose", "601R1"),
        hose(database, "draft-import", "HOSE-NEW-04", "601R1", "-4"),
        product(database, "draft-import", "HOSE-DRAFT-04", "hose", "601R1", {
          publication: "Draft",
          rfq: "Manual Quote Only",
          supply: "temporarily_unavailable",
        }),
        hose(database, "draft-import", "HOSE-DRAFT-04", "601R1", "-4"),
        product(database, "draft-import", "END-MANUAL-04", "hose_end", null, {
          rfq: "Manual Quote Only",
        }),
        hoseEnd(database, "draft-import", "END-MANUAL-04", "-4"),
        product(
          database,
          "draft-import",
          "FERRULE-UNAVAILABLE-04",
          "ferrule",
          null,
          { supply: "temporarily_unavailable" },
        ),
        ferrule(
          database,
          "draft-import",
          "FERRULE-UNAVAILABLE-04",
          "601R1",
          "-4",
        ),
        product(database, "draft-import", "END-WRONG-DASH", "hose_end", null),
        hoseEnd(database, "draft-import", "END-WRONG-DASH", "-5"),
        product(
          database,
          "draft-import",
          "FERRULE-WRONG-SERIES-04",
          "ferrule",
          null,
        ),
        ferrule(
          database,
          "draft-import",
          "FERRULE-WRONG-SERIES-04",
          "701R1",
          "-4",
        ),
        product(
          database,
          "draft-import",
          "FERRULE-WRONG-SKIVE-04",
          "ferrule",
          null,
        ),
        ferrule(
          database,
          "draft-import",
          "FERRULE-WRONG-SKIVE-04",
          "601R1",
          "-4",
          "Skive",
        ),
        relationship(
          database,
          "draft-import",
          "AUTO-STALE",
          "HOSE-04",
          "END-NEW-04",
          "FERRULE-06",
        ),
        database.prepare(
          `UPDATE catalog_compatibilities
           SET reference_system = 'Automatic catalog compatibility rule'
           WHERE import_id = 'draft-import' AND compatibility_id = 'AUTO-STALE'`,
        ),
        database.prepare(
          `UPDATE catalog_compatibilities
           SET hose_end_sku = 'END-NEW-04',
               assembly_method = 'Imported method',
               crimp_program = 'SOURCE-PROGRAM',
               final_crimp_diameter_mm = 18.5,
               assembly_working_bar = 250,
               qualification_id = 'QUAL-04',
               qualification_status = 'Approved',
               technical_data_status = 'Complete',
               production_approval_status = 'approved',
               reference_system = 'Imported worksheet 04'
           WHERE import_id = 'draft-import' AND compatibility_id = 'REL-04'`,
        ),
        database.prepare(
          `INSERT INTO catalog_releases (
             id, release_number, status, source_import_id, version, created_at
           ) VALUES ('active-release', 'ACTIVE', 'draft', 'active-import', 1,
                     '2026-09-05T00:00:00.000Z')`,
        ),
        database.prepare(
          `UPDATE catalog_releases SET status = 'published', version = 2,
                  published_at = '2026-09-05T00:00:00.000Z'
           WHERE id = 'active-release'`,
        ),
        database.prepare(
          `UPDATE catalog_active_release SET release_id = 'active-release',
                  version = 2, updated_at = '2026-09-05T00:00:00.000Z'
           WHERE singleton = 1`,
        ),
        database.prepare(
          `INSERT INTO catalog_releases (
             id, release_number, status, source_import_id, version, created_at
           ) VALUES ('draft-release', 'DRAFT', 'draft', 'draft-import', 1,
                     '2026-09-05T01:00:00.000Z')`,
        ),
      ]);

      const first = await expandDraftCatalogCompatibilities(database, {
        actorId: "owner-1",
        ipAddress: "203.0.113.10",
        releaseId: "draft-release",
        requestCorrelationId: "request-compatibility-expansion-1",
      });
      expect(first).toMatchObject({
        addedCount: 2,
        affectedSkus: [
          "END-MANUAL-04",
          "END-NEW-04",
          "END-WRONG-DASH",
          "FERRULE-UNAVAILABLE-04",
          "FERRULE-WRONG-SERIES-04",
          "FERRULE-WRONG-SKIVE-04",
          "HOSE-DRAFT-04",
          "HOSE-NEW-04",
        ],
        removedCount: 1,
      });
      const rows = await database
        .prepare(
          `SELECT hose_sku, hose_end_sku, ferrule_sku, reference_system
           FROM catalog_compatibilities
           WHERE import_id = 'draft-import'
           ORDER BY hose_sku, hose_end_sku`,
        )
        .all();
      expect(rows.results).toEqual([
        {
          ferrule_sku: "FERRULE-04",
          hose_end_sku: "END-NEW-04",
          hose_sku: "HOSE-04",
          reference_system: "Imported worksheet 04",
        },
        {
          ferrule_sku: "FERRULE-06",
          hose_end_sku: "END-06",
          hose_sku: "HOSE-06",
          reference_system: null,
        },
        {
          ferrule_sku: "FERRULE-04",
          hose_end_sku: "END-04",
          hose_sku: "HOSE-NEW-04",
          reference_system: "Automatic catalog compatibility rule",
        },
        {
          ferrule_sku: "FERRULE-04",
          hose_end_sku: "END-NEW-04",
          hose_sku: "HOSE-NEW-04",
          reference_system: "Automatic catalog compatibility rule",
        },
      ]);

      const imported = await database
        .prepare(
          `SELECT compatibility_id, crimp_program, final_crimp_diameter_mm,
                  assembly_working_bar, qualification_id, qualification_status,
                  technical_data_status, production_approval_status
           FROM catalog_compatibilities
           WHERE import_id = 'draft-import' AND compatibility_id = 'REL-04'`,
        )
        .first();
      expect(imported).toEqual({
        assembly_working_bar: 250,
        compatibility_id: "REL-04",
        crimp_program: "SOURCE-PROGRAM",
        final_crimp_diameter_mm: 18.5,
        production_approval_status: "approved",
        qualification_id: "QUAL-04",
        qualification_status: "Approved",
        technical_data_status: "Complete",
      });

      const automatic = await database
        .prepare(
          `SELECT assembly_method, assembly_working_bar, crimp_program,
                  final_crimp_diameter_mm, proof_pressure_bar,
                  qualification_id, qualification_status,
                  technical_data_status, production_approval_status
           FROM catalog_compatibilities
           WHERE import_id = 'draft-import'
             AND reference_system = 'Automatic catalog compatibility rule'
           ORDER BY compatibility_id`,
        )
        .all();
      expect(automatic.results).toHaveLength(2);
      for (const row of automatic.results) {
        expect(row).toEqual({
          assembly_method: null,
          assembly_working_bar: null,
          crimp_program: null,
          final_crimp_diameter_mm: null,
          production_approval_status: "not_approved",
          proof_pressure_bar: null,
          qualification_id: null,
          qualification_status: "Not Tested",
          technical_data_status: "Pending",
        });
      }
      const blockedMatches = await database
        .prepare(
          `SELECT COUNT(*) AS count FROM catalog_compatibilities
           WHERE import_id = 'draft-import'
             AND (
               hose_sku = 'HOSE-DRAFT-04'
               OR hose_end_sku IN ('END-MANUAL-04', 'END-WRONG-DASH')
               OR ferrule_sku IN (
                 'FERRULE-UNAVAILABLE-04',
                 'FERRULE-WRONG-SERIES-04',
                 'FERRULE-WRONG-SKIVE-04'
               )
             )`,
        )
        .first<{ count: number }>();
      expect(blockedMatches?.count).toBe(0);
      const audit = await database
        .prepare(
          `SELECT payload_json FROM admin_audit_events
           WHERE event_type = 'catalog_release.compatibilities_expanded'
           ORDER BY occurred_at LIMIT 1`,
        )
        .first<{ payload_json: string }>();
      expect(JSON.parse(audit?.payload_json ?? "{}")).toMatchObject({
        affectedSkus: first?.affectedSkus,
        afterAutomaticRelationshipCount: 2,
        beforeAutomaticRelationshipCount: 1,
        ipAddress: "203.0.113.10",
        requestCorrelationId: "request-compatibility-expansion-1",
      });

      await expandDraftCatalogCompatibilities(database, {
        actorId: "owner-1",
        ipAddress: "203.0.113.10",
        releaseId: "draft-release",
        requestCorrelationId: "request-compatibility-expansion-2",
      });
      const count = await database
        .prepare(
          `SELECT COUNT(*) AS count FROM catalog_compatibilities
           WHERE import_id = 'draft-import' AND hose_end_sku = 'END-NEW-04'`,
        )
        .first<{ count: number }>();
      expect(count?.count).toBe(2);
    } finally {
      await platform.dispose();
    }
  }, 60_000);
});
