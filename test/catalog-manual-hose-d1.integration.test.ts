import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import { maintainManualHose } from "../app/modules/catalog/domain/catalog-manual-hose";
import { createD1CatalogManualHoseRepository } from "../app/modules/catalog/infrastructure/d1-catalog-manual-hose-repository";

const projectRoot = join(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function validSubmission(referencePriceUsd = 4.5) {
  return {
    hoseValues: {
      bendRadiusMm: 100,
      burstBar: 720,
      catalogPublicationStatus: "Published",
      coverColor: "Black",
      coverFinish: "Wrapped",
      coverMaterial: "Synthetic rubber",
      dash: "-4",
      equivalentStandard: "EN 853 1SN",
      fluidCompatibility: "Hydraulic oil",
      hoseSeries: "601R1",
      idMm: 6.4,
      mshaMarking: "N/A",
      nominalIdIn: 0.25,
      notes: null,
      odMm: 13.4,
      origin: "China",
      primaryStandard: "SAE 100R1AT",
      reinforcement: "One wire braid",
      rfqEligibility: "Eligible",
      skiveRequirement: "No Skive",
      sku: "601R1_001",
      source: "Manual D1 test",
      technicalDataStatus: "Complete",
      tempMaxC: 100,
      tempMinC: -40,
      tubeMaterial: "Synthetic rubber",
      weightKgM: 0.2,
      workingBar: 180,
      workingPsi: 2610,
    },
    mainImageReference: "hose-series:601R1",
    mode: "edit" as const,
    originalSalesSku: "601R1_001",
    originalSku: "601R1_001",
    salesValues: {
      baseSku: "601R1_001",
      catalogPublicationStatus: "Published",
      cartonGrossWeightKg: null,
      cartonHCm: null,
      cartonLCm: null,
      cartonWCm: null,
      continuousLengthConfirmation: null,
      countryOfOrigin: "China",
      currency: "USD",
      factoryUnitPrice: null,
      hsCode: null,
      incotermPlace: null,
      innerPackQty: null,
      leadTimeDays: 14,
      lengthIncrementFt: 1,
      masterCartonQty: null,
      minimumLengthPerPieceFt: 1,
      moq: 1,
      netUnitWeightKg: 0.2,
      notes: null,
      packageLengthFt: null,
      packingBasis: null,
      presetLength1Ft: 5,
      presetLength2Ft: 10,
      presetLength3Ft: 20,
      priceIncoterm: null,
      productType: "Hose Variant",
      quantityInputMode: "Length x Pieces",
      referencePriceUsd,
      rfqEligibility: "Eligible",
      salesSku: "601R1_001",
      salesUnit: "ft",
      technicalDataStatus: "Complete",
      tierPrice: null,
      tierQty: null,
      unitsPerSalesPack: 1,
    },
  };
}

describe("D1 manual Hose maintenance", () => {
  it("clones the active release and changes only the pending version", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hose-manual-d1-"));
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
      const now = "2026-09-04T00:00:00.000Z";
      const summary = JSON.stringify({
        adapterCount: 0,
        adapterFamilyCount: 0,
        compatibilityCount: 0,
        costBasisPriceCount: 0,
        ferruleCount: 0,
        hoseEndCount: 0,
        hoseSeriesCount: 1,
        hoseVariantCount: 1,
        quickCouplerCount: 0,
        referencePriceCount: 1,
        salesOfferCount: 1,
        skuCount: 1,
      });
      await database.batch([
        database
          .prepare(
            `INSERT INTO catalog_imports (
               id, kind, status, source_file_name, source_file_size_bytes,
               summary_json, error_count, warning_count, created_at, completed_at
             ) VALUES ('active-import', 'workbook', 'completed', 'seed.xlsx', 1,
                       ?, 0, 0, ?, ?)`,
          )
          .bind(summary, now, now),
        database.prepare(
          `INSERT INTO catalog_media_lineages
             (id, logical_reference, created_at, created_by)
           VALUES ('approved:hose-series:601R1', 'hose-series:601R1',
                   '2026-09-04T00:00:00.000Z', 'test')`,
        ),
        database.prepare(
          `INSERT INTO catalog_media_versions
             (id, lineage_id, version, source_kind, approved_reference,
              mime_type, created_at, created_by)
           VALUES ('approved-v1:hose-series:601R1', 'approved:hose-series:601R1', 1,
                   'approved_reference', 'hose-series:601R1', 'reference',
                   '2026-09-04T00:00:00.000Z', 'test')`,
        ),
        database.prepare(
          `INSERT INTO catalog_skus (
             id, import_id, sku, source_worksheet, product_type, hose_series,
             catalog_publication_status, rfq_eligibility,
             technical_data_status, supply_availability
           ) VALUES ('active-sku', 'active-import', '601R1_001',
                     '01_胶管主数据', 'hose', '601R1', 'Published', 'Eligible',
                     'Complete', 'available_for_quote')`,
        ),
        database.prepare(
          `INSERT INTO catalog_hose_series (
             id, import_id, series_code, series_name, primary_standard,
             equivalent_standard, temp_min_c, temp_max_c,
             representative_media_version_id
           ) VALUES ('active-series', 'active-import', '601R1', '601R1',
                     'SAE 100R1AT', 'EN 853 1SN', -40, 100,
                     'approved-v1:hose-series:601R1')`,
        ),
        database.prepare(
          `INSERT INTO catalog_hose_variants (
             id, import_id, sku, hose_series, primary_standard,
             equivalent_standard, dash, nominal_id_in, id_mm, od_mm,
             working_bar, working_psi, burst_bar, bend_radius_mm, weight_kg_m,
             temp_min_c, temp_max_c, tube_material, reinforcement,
             cover_material, cover_color, cover_finish, skive_requirement,
             msha_marking, fluid_compatibility, origin, source, notes
           ) VALUES (
             'active-hose', 'active-import', '601R1_001', '601R1', 'SAE 100R1AT',
             'EN 853 1SN', '-4', 0.25, 6.4, 13.4, 180, 2610, 720, 100, 0.2,
             -40, 100, 'Synthetic rubber', 'One wire braid', 'Synthetic rubber',
             'Black', 'Wrapped', 'No Skive', 'N/A', 'Hydraulic oil', 'China',
             'Seed source', NULL
           )`,
        ),
        database.prepare(
          `INSERT INTO catalog_sales_offers (
             id, import_id, base_sku, sales_sku, product_type, sales_unit,
             package_length_ft, units_per_sales_pack, moq, net_unit_weight_kg,
             lead_time_days, country_of_origin, currency, reference_price_usd,
             inner_pack_qty, master_carton_qty, carton_gross_weight_kg,
             carton_l_cm, carton_w_cm, carton_h_cm, packing_basis, hs_code,
             notes, catalog_publication_status, rfq_eligibility,
             technical_data_status, quantity_input_mode,
             minimum_length_per_piece_ft, length_increment_ft,
             preset_length_1_ft, preset_length_2_ft, preset_length_3_ft,
             continuous_length_confirmation
           ) VALUES (
             'active-offer', 'active-import', '601R1_001', '601R1_001',
             'Hose Variant', 'ft', NULL, 1, 1, 0.2, 14, 'China', 'USD', 3.25,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Published',
             'Eligible', 'Complete', 'Length x Pieces', 1, 1, 5, 10, 20, NULL
           )`,
        ),
        database.prepare(
          `INSERT INTO catalog_cost_bases (
             id, import_id, sales_sku, currency, factory_unit_price,
             price_incoterm, incoterm_place, tier_qty, tier_price
           ) VALUES ('active-cost', 'active-import', '601R1_001', 'USD',
                     NULL, NULL, NULL, NULL, NULL)`,
        ),
        database
          .prepare(
            `INSERT INTO catalog_releases (
               id, release_number, status, source_import_id,
               version, created_at, published_at
             ) VALUES ('active-release', 'ACTIVE-1', 'draft', 'active-import',
                       1, ?, NULL)`,
          )
          .bind(now),
        database
          .prepare(
            `UPDATE catalog_releases
             SET status = 'published', version = version + 1, published_at = ?
             WHERE id = 'active-release'`,
          )
          .bind(now),
        database
          .prepare(
            `UPDATE catalog_active_release
             SET release_id = 'active-release', version = version + 1,
                 updated_at = ?
             WHERE singleton = 1`,
          )
          .bind(now),
      ]);

      const ids = [
        "draft-release",
        "draft-import",
        "audit-edit",
        "cost-unused",
        "hose-unused",
        "offer-unused",
        "sku-unused",
      ];
      const result = await maintainManualHose(
        createD1CatalogManualHoseRepository(database),
        {
          actorId: "owner-1",
          generateId: () => ids.shift() ?? "unexpected",
          now: () => new Date("2026-09-04T01:00:00.000Z"),
          ...validSubmission(4.5),
        },
      );

      expect(result).toMatchObject({
        draftReleaseId: "draft-release",
        mode: "updated",
        sku: "601R1_001",
      });
      expect(
        await database
          .prepare(
            `SELECT reference_price_usd FROM catalog_sales_offers
             WHERE import_id = 'active-import' AND base_sku = '601R1_001'`,
          )
          .first(),
      ).toEqual({ reference_price_usd: 3.25 });
      expect(
        await database
          .prepare(
            `SELECT offer.reference_price_usd, product.supply_availability
             FROM catalog_releases release
             INNER JOIN catalog_sales_offers offer
               ON offer.import_id = release.source_import_id
             INNER JOIN catalog_skus product
               ON product.import_id = offer.import_id
              AND product.sku = offer.base_sku
             WHERE release.id = 'draft-release' AND offer.base_sku = '601R1_001'`,
          )
          .first(),
      ).toEqual({
        reference_price_usd: 4.5,
        supply_availability: "available_for_quote",
      });
      expect(
        await database
          .prepare(
            `SELECT actor_id, event_type FROM admin_audit_events
             WHERE id = 'audit-edit'`,
          )
          .first(),
      ).toEqual({
        actor_id: "owner-1",
        event_type: "catalog_manual.hose_updated",
      });

      const loaded =
        await createD1CatalogManualHoseRepository(database).findHoseByExactSku(
          "601r1_001",
        );
      expect(loaded).toMatchObject({
        hose: { sku: "601R1_001" },
        release: { id: "draft-release", status: "draft" },
        salesOffer: { referencePriceUsd: 4.5 },
      });
    } finally {
      await platform.dispose();
    }
  }, 60_000);
});
