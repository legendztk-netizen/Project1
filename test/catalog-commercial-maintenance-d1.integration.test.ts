import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import {
  maintainSeriesCommercialRule,
  maintainSkuPricePackaging,
  type SeriesCommercialRule,
  type SkuPricePackaging,
} from "../app/modules/catalog/domain/catalog-commercial-maintenance";
import {
  maintainHoseSeries,
  maintainHoseVariant,
} from "../app/modules/catalog/domain/catalog-hose-maintenance";
import { createD1CatalogCommercialMaintenanceRepository } from "../app/modules/catalog/infrastructure/d1-catalog-commercial-maintenance-repository";
import { createD1CatalogManualHoseRepository } from "../app/modules/catalog/infrastructure/d1-catalog-manual-hose-repository";
import { createD1CatalogPublicationRepository } from "../app/modules/catalog/infrastructure/d1-catalog-publication-repository";

const projectRoot = join(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const rule: SeriesCommercialRule = {
  continuousLengthConfirmation: "Required",
  countryOfOrigin: "China",
  hsCode: "4009.21",
  leadTimeDays: 14,
  lengthIncrementFt: 1,
  minimumLengthPerPieceFt: 3,
  moq: 1,
  notes: null,
  presetLength1Ft: 10,
  presetLength2Ft: 25,
  presetLength3Ft: 50,
  productType: "hose",
  quantityInputMode: "length",
  salesUnit: "ft",
  seriesCode: "601R1",
};

function exact(sku: string, price: number | null): SkuPricePackaging {
  return {
    cartonGrossWeightKg: null,
    cartonHCm: null,
    cartonLCm: null,
    cartonWCm: null,
    currency: "USD",
    innerPackQty: null,
    masterCartonQty: null,
    netUnitWeightKg: null,
    packageLengthFt: null,
    packingBasis: null,
    referencePrice: price,
    salesSku: sku,
    sku,
    unitsPerSalesPack: null,
  };
}

describe("D1 catalog commercial maintenance", () => {
  it("inherits one rule, isolates SKU prices, audits writes and blocks a missing Online price", async () => {
    const directory = mkdtempSync(join(tmpdir(), "catalog-commercial-d1-"));
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
      const manual = createD1CatalogManualHoseRepository(platform.env.DB);
      const seriesIds = [
        "draft-release",
        "series-audit",
        "draft-import",
        "series-id",
      ];
      await maintainHoseSeries(manual, {
        actorId: "owner-1",
        generateId: () => seriesIds.shift() ?? "unexpected-series-id",
        mode: "create",
        now: () => new Date("2026-09-05T01:00:00.000Z"),
        originalSeriesCode: null,
        series: {
          coverColor: "Black",
          coverFinish: null,
          coverMaterial: null,
          equivalentStandard: "EN 853 1SN",
          fluidCompatibility: null,
          primaryStandard: "SAE 100 R1AT",
          reinforcement: null,
          representativeImageReference: "hose-series:601R1",
          seriesCode: "601R1",
          seriesName: "601R1",
          tempMaxC: 100,
          tempMinC: -40,
          tubeMaterial: null,
        },
      });

      for (const [index, sku] of ["601R1_001", "601R1_002"].entries()) {
        const ids = [
          `unused-release-${index}`,
          `variant-audit-${index}`,
          `unused-import-${index}`,
          `media-${index}`,
          `sku-${index}`,
          `variant-${index}`,
        ];
        await maintainHoseVariant(manual, {
          actorId: "owner-1",
          generateId: () => ids.shift() ?? `unexpected-${index}`,
          imageOverrideReference: null,
          lifecycleStatus: "online",
          mode: "create",
          now: () => new Date(`2026-09-05T01:${index + 1}0:00.000Z`),
          originalSku: null,
          variant: {
            bendRadiusMm: 100,
            burstBar: 720,
            dash: `-${index + 4}`,
            hoseSeries: "601R1",
            idMm: 6.4 + index,
            mshaMarking: null,
            nominalIdIn: 0.25,
            notes: "Launch size",
            odMm: 13.4 + index,
            skiveRequirement: null,
            sku,
            source: null,
            technicalDataStatus: null,
            weightKgM: 0.2,
            workingBar: 180,
            workingPsi: 2610,
          },
        });
      }

      const commercial = createD1CatalogCommercialMaintenanceRepository(
        platform.env.DB,
      );
      const ruleIds = [
        "unused-rule-release",
        "rule-audit",
        "unused-rule-import",
        "rule-id",
      ];
      await maintainSeriesCommercialRule(commercial, {
        actorId: "owner-1",
        generateId: () => ruleIds.shift() ?? "unexpected-rule-id",
        now: () => new Date("2026-09-05T02:00:00.000Z"),
        rule,
      });
      const exactIds = [
        "unused-price-release",
        "price-audit",
        "unused-price-import",
        "price-id",
      ];
      await maintainSkuPricePackaging(commercial, {
        actorId: "owner-1",
        generateId: () => exactIds.shift() ?? "unexpected-price-id",
        ipAddress: "203.0.113.8",
        now: () => new Date("2026-09-05T02:10:00.000Z"),
        packaging: exact("601R1_001", 2.16),
        requestCorrelationId: "commercial-price-request",
        sku: "601R1_001",
      });

      const editIds = [
        "unused-edit-release",
        "rule-edit-audit",
        "unused-edit-import",
        "unused-edit-id",
      ];
      await maintainSeriesCommercialRule(commercial, {
        actorId: "owner-2",
        generateId: () => editIds.shift() ?? "unexpected-edit-id",
        now: () => new Date("2026-09-05T02:20:00.000Z"),
        rule: { ...rule, leadTimeDays: 7, moq: 5 },
      });

      expect(await commercial.findSeriesRule("hose", "601R1")).toMatchObject({
        leadTimeDays: 7,
        moq: 5,
      });
      expect(await commercial.findSkuPricePackaging("601R1_001")).toEqual(
        expect.objectContaining({
          currency: "USD",
          packageLengthFt: null,
          referencePrice: 2.16,
          salesSku: "601R1_001",
        }),
      );
      expect(await commercial.findSkuPricePackaging("601R1_002")).toBeNull();
      expect(
        await platform.env.DB.prepare(
          `SELECT currency, factory_unit_price, price_incoterm, tier_price
           FROM catalog_cost_bases
           WHERE import_id = 'draft-import' AND sales_sku = '601R1_001'`,
        ).first(),
      ).toEqual({
        currency: "USD",
        factory_unit_price: null,
        price_incoterm: null,
        tier_price: null,
      });
      expect(
        await platform.env.DB.prepare(
          `SELECT COUNT(*) AS count FROM catalog_series_commercial_rules
           WHERE import_id = 'draft-import' AND series_code = '601R1'`,
        ).first(),
      ).toEqual({ count: 1 });
      expect(
        await platform.env.DB.prepare(
          `SELECT event_type,
                  json_extract(payload_json, '$.ipAddress') AS ip_address,
                  json_extract(payload_json, '$.requestCorrelationId') AS request_id,
                  json_extract(payload_json, '$.before.leadTimeDays') AS before_lead_time,
                  json_extract(payload_json, '$.after.leadTimeDays') AS after_lead_time,
                  json_extract(payload_json, '$.after.referencePrice') AS after_price
           FROM admin_audit_events
           WHERE id IN ('rule-audit', 'price-audit', 'rule-edit-audit') ORDER BY occurred_at`,
        ).all(),
      ).toMatchObject({
        results: [
          {
            event_type: "catalog_commercial.series_rule_saved",
            after_lead_time: 14,
            before_lead_time: null,
            ip_address: "local",
            request_id: "rule-audit",
          },
          {
            event_type: "catalog_commercial.sku_price_packaging_saved",
            after_price: 2.16,
            ip_address: "203.0.113.8",
            request_id: "commercial-price-request",
          },
          {
            event_type: "catalog_commercial.series_rule_saved",
            after_lead_time: 7,
            before_lead_time: 14,
            ip_address: "local",
            request_id: "rule-edit-audit",
          },
        ],
      });

      const preview = await createD1CatalogPublicationRepository(
        platform.env.DB,
      ).findPublicationPreview("draft-release");
      expect(preview?.blockers).toContainEqual(
        expect.objectContaining({ code: "missing_reference_price" }),
      );
      await expect(
        platform.env.DB.prepare(
          `INSERT INTO catalog_sku_price_packaging
             (id, import_id, sku, sales_sku, currency)
           VALUES ('bad-currency', 'draft-import', '601R1_002', '601R1_002', 'EUR')`,
        ).run(),
      ).rejects.toThrow();
    } finally {
      await platform.dispose();
    }
  }, 60_000);
});
