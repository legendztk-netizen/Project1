import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import { maintainManualComponent } from "../app/modules/catalog/domain/catalog-manual-component";
import { createD1CatalogManualHoseRepository } from "../app/modules/catalog/infrastructure/d1-catalog-manual-hose-repository";

const projectRoot = join(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function salesValues(sku: string, productType: "Ferrule" | "Hose End") {
  return {
    baseSku: sku,
    catalogPublicationStatus: "Published",
    countryOfOrigin: "China",
    currency: "USD",
    leadTimeDays: 14,
    moq: 1,
    productType,
    quantityInputMode: "Units",
    referencePriceUsd: 4.25,
    rfqEligibility: "Eligible",
    salesSku: sku,
    salesUnit: "each",
    technicalDataStatus: "Complete",
    unitsPerSalesPack: 1,
  };
}

describe("D1 manual Hose End and Ferrule maintenance", () => {
  it("writes both products atomically to one pending version and audits outcomes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "component-manual-d1-"));
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
      const repository = createD1CatalogManualHoseRepository(database);
      const hoseEndSku = "JIC_F_SW_04_04_D1";
      const ferruleSku = "601R1_1WB_D1";

      const hoseEnd = await maintainManualComponent(repository, {
        actorId: "owner-1",
        generateId: () => crypto.randomUUID(),
        mainImageReference: "hose-end-shape:JIC 37°-Female-Swivel-0° Straight",
        masterValues: {
          angle: "0° Straight",
          catalogPublicationStatus: "Published",
          coating: "Zinc plating",
          connectionDash: "-4",
          connectionStandard: "SAE J514",
          fittingSeries: "JIC test",
          gender: "Female",
          hoseTailDash: "-4",
          interfaceFamily: "JIC 37°",
          rfqEligibility: "Eligible",
          sealingForm: "37° cone",
          sku: hoseEndSku,
          source: "D1 Hose End test",
          swivelForm: "Swivel",
          technicalDataStatus: "Complete",
          thread: "7/16-20 UNF",
        },
        mode: "create",
        now: () => new Date("2026-09-04T08:00:00.000Z"),
        originalSalesSku: null,
        originalSku: null,
        productType: "hose_end",
        salesValues: salesValues(hoseEndSku, "Hose End"),
      });

      const ferrule = await maintainManualComponent(repository, {
        actorId: "owner-1",
        generateId: () => crypto.randomUUID(),
        mainImageReference: "catalog-source:62d65f8412ff5.pdf:ferrule:p49-50",
        masterValues: {
          catalogPublicationStatus: "Published",
          coating: "Zinc plating",
          ferruleSeries: "601R1",
          hoseConstruction: "1-wire braid",
          hoseTailDash: "-4",
          material: "Carbon steel",
          rfqEligibility: "Eligible",
          skiveRequirement: "Other",
          sku: ferruleSku,
          source: "D1 Ferrule test",
          technicalDataStatus: "Complete",
        },
        mode: "create",
        now: () => new Date("2026-09-04T08:01:00.000Z"),
        originalSalesSku: null,
        originalSku: null,
        productType: "ferrule",
        salesValues: salesValues(ferruleSku, "Ferrule"),
      });

      expect(hoseEnd.draftReleaseId).toBe(ferrule.draftReleaseId);
      expect(
        await database
          .prepare(
            `SELECT product_type, sku, supply_availability
             FROM catalog_skus ORDER BY product_type`,
          )
          .all(),
      ).toMatchObject({
        results: [
          {
            product_type: "ferrule",
            sku: ferruleSku,
            supply_availability: "temporarily_unavailable",
          },
          {
            product_type: "hose_end",
            sku: hoseEndSku,
            supply_availability: "temporarily_unavailable",
          },
        ],
      });
      expect(
        await database
          .prepare(
            `SELECT base_sku, product_type, reference_price_usd
             FROM catalog_sales_offers ORDER BY product_type`,
          )
          .all(),
      ).toMatchObject({
        results: [
          {
            base_sku: ferruleSku,
            product_type: "Ferrule",
            reference_price_usd: 4.25,
          },
          {
            base_sku: hoseEndSku,
            product_type: "Hose End",
            reference_price_usd: 4.25,
          },
        ],
      });

      const loadedHoseEnd = await repository.findComponentByExactSku(
        "hose_end",
        hoseEndSku.toLowerCase(),
      );
      const loadedFerrule = await repository.findComponentByExactSku(
        "ferrule",
        ferruleSku.toLowerCase(),
      );
      expect(loadedHoseEnd).toMatchObject({
        mainImageReference: "hose-end-shape:JIC 37°-Female-Swivel-0° Straight",
        master: { sku: hoseEndSku },
        productType: "hose_end",
      });
      expect(loadedFerrule).toMatchObject({
        mainImageReference: "catalog-source:62d65f8412ff5.pdf:ferrule:p49-50",
        master: { sku: ferruleSku },
        productType: "ferrule",
      });

      const invalid = {
        ...salesValues("INVALID-FERRULE", "Ferrule"),
        referencePriceUsd: null,
      };
      await expect(
        maintainManualComponent(repository, {
          actorId: "owner-1",
          mainImageReference: "",
          masterValues: {
            catalogPublicationStatus: "Published",
            coating: "Zinc plating",
            ferruleSeries: "601R1",
            hoseConstruction: "1-wire braid",
            hoseTailDash: "-4",
            material: "Carbon steel",
            rfqEligibility: "Eligible",
            skiveRequirement: "Other",
            sku: "INVALID-FERRULE",
            source: "D1 invalid test",
            technicalDataStatus: "Complete",
          },
          mode: "create",
          originalSalesSku: null,
          originalSku: null,
          productType: "ferrule",
          salesValues: invalid,
        }),
      ).rejects.toThrow("validation errors");
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM catalog_ferrules")
          .first(),
      ).toEqual({ count: 1 });
      expect(
        await database
          .prepare(
            `SELECT event_type FROM admin_audit_events
             WHERE entity_id = 'INVALID-FERRULE'`,
          )
          .first(),
      ).toEqual({ event_type: "catalog_manual.component_rejected" });
    } finally {
      await platform.dispose();
    }
  }, 60_000);
});
