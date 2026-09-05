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

function salesValues(sku: string, productType: "Adapter" | "Quick Coupler") {
  return {
    baseSku: sku,
    catalogPublicationStatus: "Published",
    countryOfOrigin: "China",
    currency: "USD",
    leadTimeDays: 10,
    moq: 1,
    productType,
    quantityInputMode: "Units",
    referencePriceUsd: 12.5,
    rfqEligibility: "Eligible",
    salesSku: sku,
    salesUnit: "each",
    technicalDataStatus: "Complete",
    unitsPerSalesPack: 1,
  };
}

describe("D1 manual Adapter and Quick Coupler maintenance", () => {
  it("writes, reloads, updates, and audits both product types atomically", async () => {
    const directory = mkdtempSync(join(tmpdir(), "commercial-component-d1-"));
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
      const adapterSku = "ADP_ST_JIC_M_10_NPT_M_04";
      const quickCouplerSku = "QDC_16028_SOC_04_FNPT_04";
      const adapterMaster = {
        adapterFamilyId: "ADP-ST-JIC-NPT",
        adapterSku,
        catalogModel: "2404",
        catalogPublicationStatus: "Published",
        connectionForm1: "M",
        connectionForm2: "M",
        interface1: "JIC",
        interface2: "NPT",
        rfqEligibility: "Eligible",
        shapeCode: "ST",
        size1: "-10",
        size2: "-4",
        skuTemplate: "ADP_ST_JIC_M_{SIZE1}_NPT_M_{SIZE2}",
        source: "D1 Adapter test",
        technicalDataStatus: "Complete",
        websiteDisplay: "Straight adapter",
        websiteProductName: "Straight JIC to NPT Adapter",
      };

      const adapter = await maintainManualComponent(repository, {
        actorId: "owner-1",
        mainImageReference:
          "catalog-source:https://www.discounthydraulichose.com/2404-jic-37-male-x-nptf-male-pipe.html:adapter:straight",
        masterValues: adapterMaster,
        mode: "create",
        originalSalesSku: null,
        originalSku: null,
        productType: "adapter",
        salesValues: salesValues(adapterSku, "Adapter"),
      });
      const quickCoupler = await maintainManualComponent(repository, {
        actorId: "owner-1",
        mainImageReference:
          "catalog-source:62d65f8412ff5.pdf:quick-coupler:p52",
        masterValues: {
          bodySize: "1/4 in",
          catalogPublicationStatus: "Published",
          connectionMechanism: "Push-to-connect",
          couplerSeries: "FEM",
          interchangeStandard: "ISO 16028",
          matingSeries: "FEM",
          portGender: "Female",
          portInterface: "NPTF",
          portThread: "1/4-18 NPTF",
          rfqEligibility: "Eligible",
          role: "Coupler/Socket",
          sku: quickCouplerSku,
          source: "D1 Quick Coupler test",
          technicalDataStatus: "Complete",
          valving: "Flat face",
        },
        mode: "create",
        originalSalesSku: null,
        originalSku: null,
        productType: "quick_coupler",
        salesValues: salesValues(quickCouplerSku, "Quick Coupler"),
      });

      expect(adapter.draftReleaseId).toBe(quickCoupler.draftReleaseId);
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
            product_type: "adapter",
            sku: adapterSku,
            supply_availability: "temporarily_unavailable",
          },
          {
            product_type: "quick_coupler",
            sku: quickCouplerSku,
            supply_availability: "temporarily_unavailable",
          },
        ],
      });
      expect(
        await database
          .prepare(
            `SELECT adapter_family_id, website_display
             FROM catalog_adapter_families`,
          )
          .first(),
      ).toEqual({
        adapter_family_id: "ADP-ST-JIC-NPT",
        website_display: "Straight adapter",
      });
      expect(
        await database
          .prepare(
            `SELECT sku_standard_code, sku_role_code, body_dash, port_code, port_dash
             FROM catalog_quick_couplers`,
          )
          .first(),
      ).toEqual({
        body_dash: "04",
        port_code: "FNPT",
        port_dash: "04",
        sku_role_code: "SOC",
        sku_standard_code: "16028",
      });

      expect(
        await repository.findComponentByExactSku("adapter", adapterSku),
      ).toMatchObject({
        mainImageReference: expect.stringContaining("adapter:straight"),
        master: { sku: adapterSku },
        productType: "adapter",
      });
      expect(
        await repository.findComponentByExactSku(
          "quick_coupler",
          quickCouplerSku.toLowerCase(),
        ),
      ).toMatchObject({
        mainImageReference: expect.stringContaining("quick-coupler:p52"),
        master: { sku: quickCouplerSku },
        productType: "quick_coupler",
      });

      await maintainManualComponent(repository, {
        actorId: "owner-1",
        mainImageReference:
          "catalog-source:https://www.discounthydraulichose.com/2404-jic-37-male-x-nptf-male-pipe.html:adapter:straight",
        masterValues: { ...adapterMaster, websiteDisplay: "Updated display" },
        mode: "edit",
        originalSalesSku: adapterSku,
        originalSku: adapterSku,
        productType: "adapter",
        salesValues: {
          ...salesValues(adapterSku, "Adapter"),
          referencePriceUsd: 15,
        },
      });
      expect(
        await database
          .prepare(
            `SELECT family.website_display, offer.reference_price_usd
             FROM catalog_adapter_families family
             INNER JOIN catalog_sales_offers offer
               ON offer.import_id = family.import_id
              AND offer.base_sku = ?
             WHERE family.adapter_family_id = ?`,
          )
          .bind(adapterSku, "ADP-ST-JIC-NPT")
          .first(),
      ).toEqual({
        reference_price_usd: 15,
        website_display: "Updated display",
      });

      await expect(
        maintainManualComponent(repository, {
          actorId: "owner-1",
          mainImageReference: "",
          masterValues: {
            ...adapterMaster,
            adapterSku: "ADP_ST_JIC_M_08_NPT_M_04",
            size1: "-8",
          },
          mode: "create",
          originalSalesSku: null,
          originalSku: null,
          productType: "adapter",
          salesValues: {
            ...salesValues("ADP_ST_JIC_M_08_NPT_M_04", "Adapter"),
            referencePriceUsd: null,
          },
        }),
      ).rejects.toThrow("validation errors");
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM catalog_adapters")
          .first(),
      ).toEqual({ count: 1 });
      expect(
        await database
          .prepare(
            `SELECT COUNT(*) AS count FROM admin_audit_events
             WHERE event_type = 'catalog_manual.component_rejected'`,
          )
          .first(),
      ).toEqual({ count: 1 });
    } finally {
      await platform.dispose();
    }
  }, 60_000);
});
