import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import { createD1CatalogAssemblyImpactRepository } from "../app/modules/catalog/infrastructure/d1-catalog-assembly-impact-repository";

const auditContext = {
  ipAddress: "203.0.113.10",
  requestCorrelationId: "assembly-impact-test",
};

const projectRoot = join(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function productInsert(
  database: D1Database,
  importId: string,
  suffix: string,
  sku: string,
  productType: "ferrule" | "hose" | "hose_end",
  hoseSeries: string | null,
  supplyAvailability = "available_for_quote",
) {
  return database
    .prepare(
      `INSERT INTO catalog_skus (
         id, import_id, sku, source_worksheet, product_type, hose_series,
         catalog_publication_status, rfq_eligibility,
         technical_data_status, supply_availability
       ) VALUES (?, ?, ?, 'fixture', ?, ?, 'Published', 'Eligible',
                 'Complete', ?)`,
    )
    .bind(
      `${suffix}-${sku}`,
      importId,
      sku,
      productType,
      hoseSeries,
      supplyAvailability,
    );
}

function compatibilityInsert(
  database: D1Database,
  importId: string,
  suffix: string,
  hoseSku: string,
) {
  return database
    .prepare(
      `INSERT INTO catalog_compatibilities (
         id, import_id, compatibility_id, hose_sku, hose_end_sku,
         ferrule_sku, qualification_status, rfq_eligibility,
         technical_data_status, production_approval_status,
         catalog_publication_status
       ) VALUES (?, ?, ?, ?, 'END-SHARED', 'FERRULE-SHARED', 'Approved',
                 'Eligible', 'Complete', 'approved', 'Published')`,
    )
    .bind(
      `${suffix}-relationship-${hoseSku}`,
      importId,
      `COMP-${hoseSku}`,
      hoseSku,
    );
}

describe("D1 affected Assembly Series persistence", () => {
  it("persists the system-owned set, audits changes, and keeps repeat reads idempotent", async () => {
    const directory = mkdtempSync(join(tmpdir(), "assembly-impact-d1-"));
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
                       1, '{}', 0, 0, '2026-09-04T00:00:00.000Z',
                       '2026-09-04T00:00:00.000Z')`,
          ),
        ),
        productInsert(
          database,
          "active-import",
          "active",
          "HOSE-A",
          "hose",
          "SERIES-A",
        ),
        productInsert(
          database,
          "active-import",
          "active",
          "HOSE-B",
          "hose",
          "SERIES-B",
        ),
        productInsert(
          database,
          "active-import",
          "active",
          "END-SHARED",
          "hose_end",
          null,
        ),
        productInsert(
          database,
          "active-import",
          "active",
          "FERRULE-SHARED",
          "ferrule",
          null,
        ),
        productInsert(
          database,
          "draft-import",
          "draft",
          "HOSE-A",
          "hose",
          "SERIES-A",
        ),
        productInsert(
          database,
          "draft-import",
          "draft",
          "HOSE-B",
          "hose",
          "SERIES-B",
        ),
        productInsert(
          database,
          "draft-import",
          "draft",
          "END-SHARED",
          "hose_end",
          null,
          "temporarily_unavailable",
        ),
        productInsert(
          database,
          "draft-import",
          "draft",
          "FERRULE-SHARED",
          "ferrule",
          null,
        ),
        compatibilityInsert(database, "active-import", "active", "HOSE-A"),
        compatibilityInsert(database, "active-import", "active", "HOSE-B"),
        compatibilityInsert(database, "draft-import", "draft", "HOSE-A"),
        compatibilityInsert(database, "draft-import", "draft", "HOSE-B"),
        ...[
          ["active", "active-import", 10],
          ["draft", "draft-import", 12],
        ].map(([suffix, importId, price]) =>
          database.prepare(
            `INSERT INTO catalog_sales_offers (
               id, import_id, base_sku, sales_sku, product_type, sales_unit,
               units_per_sales_pack, moq, lead_time_days, country_of_origin,
               currency, reference_price_usd, catalog_publication_status,
               rfq_eligibility, technical_data_status, quantity_input_mode
             ) VALUES ('${suffix}-offer', '${importId}', 'END-SHARED',
                       '${suffix}-END-SHARED-EA', 'hose_end', 'each', 1, 1, 7,
                       'CN', 'USD', ${price}, 'Published', 'Eligible',
                       'Complete', 'quantity')`,
          ),
        ),
        database.prepare(
          `INSERT INTO catalog_releases (
             id, release_number, status, source_import_id, version, created_at,
             published_at
           ) VALUES ('active-release', 'ACTIVE', 'draft', 'active-import', 1,
                     '2026-09-04T00:00:00.000Z', NULL)`,
        ),
        ...["SERIES-A", "SERIES-B"].map((series) =>
          database.prepare(
            `INSERT INTO catalog_derived_assembly_series (
               release_id, source_import_id, hose_series, generation_id,
               input_fingerprint, combination_count, generated_at, generated_by
             ) VALUES ('active-release', 'active-import', '${series}', 'seed',
                       'seed-input', 0, '2026-09-04T00:00:00.000Z', 'system')`,
          ),
        ),
        database.prepare(
          `UPDATE catalog_releases
           SET status = 'published', version = version + 1,
               published_at = '2026-09-04T00:00:00.000Z'
           WHERE id = 'active-release'`,
        ),
        database.prepare(
          `UPDATE catalog_active_release
           SET release_id = 'active-release', version = 4,
               updated_at = '2026-09-04T00:00:00.000Z'
           WHERE singleton = 1`,
        ),
        database.prepare(
          `INSERT INTO catalog_releases (
             id, release_number, status, source_import_id, version, created_at
           ) VALUES ('draft-release', 'DRAFT', 'draft', 'draft-import', 1,
                     '2026-09-04T01:00:00.000Z')`,
        ),
      ]);

      const repository = createD1CatalogAssemblyImpactRepository(database);
      const first = await repository.recalculate({
        actorId: "owner-1",
        ...auditContext,
        generateId: () => "impact-calculation-1",
        now: () => new Date("2026-09-04T02:00:00.000Z"),
        releaseId: "draft-release",
      });
      expect(first).toMatchObject({
        activeGeneration: 4,
        affectedSeries: ["SERIES-A", "SERIES-B"],
        baselineReleaseId: "active-release",
        stale: true,
        status: "stale",
      });

      await database
        .prepare(
          `UPDATE catalog_sales_offers SET reference_price_usd = 99
           WHERE import_id = 'draft-import' AND base_sku = 'END-SHARED'`,
        )
        .run();
      await repository.recalculate({
        actorId: "owner-1",
        ...auditContext,
        generateId: () => "should-not-be-used",
        releaseId: "draft-release",
      });
      expect(
        await database
          .prepare(
            `SELECT COUNT(*) AS count FROM admin_audit_events
             WHERE event_type = 'catalog_release.assembly_impact_calculated'`,
          )
          .first(),
      ).toEqual({ count: 1 });
      const impactAudit = await database
        .prepare(
          `SELECT payload_json FROM admin_audit_events
           WHERE event_type = 'catalog_release.assembly_impact_calculated'
           ORDER BY occurred_at LIMIT 1`,
        )
        .first<{ payload_json: string }>();
      expect(JSON.parse(impactAudit?.payload_json ?? "{}")).toMatchObject({
        ...auditContext,
        after: expect.objectContaining({
          affectedSeries: expect.any(Array),
          inputFingerprint: expect.any(String),
          status: expect.any(String),
        }),
        before: null,
      });

      await database
        .prepare(
          `UPDATE catalog_skus SET supply_availability = 'available_for_quote'
           WHERE import_id = 'draft-import' AND sku = 'END-SHARED'`,
        )
        .run();
      const current = await repository.recalculate({
        actorId: "owner-1",
        ...auditContext,
        generateId: () => "impact-calculation-2",
        now: () => new Date("2026-09-04T03:00:00.000Z"),
        releaseId: "draft-release",
      });
      expect(current).toMatchObject({
        affectedSeries: [],
        sourceChanges: [],
        stale: false,
        status: "current",
      });
      expect(
        await database
          .prepare(
            `SELECT COUNT(*) AS count FROM admin_audit_events
             WHERE event_type = 'catalog_release.assembly_impact_calculated'`,
          )
          .first(),
      ).toEqual({ count: 2 });
    } finally {
      await platform.dispose();
    }
  }, 60_000);
});
