import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import {
  maintainHoseEndSeries,
  maintainHoseEndVariant,
} from "../app/modules/catalog/domain/catalog-hose-end-maintenance";
import { createD1CatalogManualHoseRepository } from "../app/modules/catalog/infrastructure/d1-catalog-manual-hose-repository";

const projectRoot = join(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("D1 Hose End series and variant maintenance", () => {
  it("atomically writes inherited series identity, lifecycle and audits without sales data", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hose-end-maintenance-d1-"));
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
      const repository = createD1CatalogManualHoseRepository(platform.env.DB);
      const seriesIds = [
        "draft-release",
        "series-audit",
        "draft-import",
        "series-id",
      ];
      await maintainHoseEndSeries(repository, {
        actorId: "owner-1",
        generateId: () => seriesIds.shift() ?? "unexpected-series-id",
        mode: "create",
        now: () => new Date("2026-09-05T01:00:00.000Z"),
        originalSeriesCode: null,
        series: {
          angle: "0° Straight",
          gender: "Female",
          interfaceFamily: "JIC 37°",
          interfaceStandard: "SAE J514",
          representativeImageReference:
            "hose-end-shape:JIC 37°-Female-Swivel-0° Straight",
          sealingForm: "37° flare",
          seriesCode: "FJX",
          seriesName: "JIC Female Swivel",
          swivelForm: "Swivel",
        },
      });

      const variantIds = [
        "unused-release",
        "variant-audit",
        "unused-import",
        "media-id",
        "sku-id",
        "variant-id",
      ];
      const variantInput = {
        coating: "Zinc nickel",
        competitorPartNumber: null,
        connectionDash: "-04",
        cutoffBMm: 0,
        dimensionAMm: 45,
        drawingNumber: null,
        drawingRevision: null,
        fittingSeries: "FJX",
        hex1Mm: 14,
        hex2Mm: 0,
        hoseTailDash: "-04",
        material: "Carbon steel",
        maxWorkingBar: 350,
        minimumBoreMm: 5,
        notes: "Launch size",
        saltSprayHours: 0,
        sku: "FJX-04-04",
        source: null,
        technicalDataStatus: null,
        thread: "7/16-20 UNF",
        unitWeightG: 82,
      };
      await maintainHoseEndVariant(repository, {
        actorId: "owner-1",
        generateId: () => variantIds.shift() ?? "unexpected-variant-id",
        imageOverrideReference: null,
        lifecycleStatus: "online",
        mode: "create",
        now: () => new Date("2026-09-05T01:10:00.000Z"),
        originalSku: null,
        variant: variantInput,
      });

      const editSeriesIds = [
        "unused-edit-release",
        "series-edit-audit",
        "unused-edit-import",
        "unused-edit-series-id",
      ];
      await maintainHoseEndSeries(repository, {
        actorId: "owner-2",
        generateId: () => editSeriesIds.shift() ?? "unexpected-series-edit-id",
        mode: "edit",
        now: () => new Date("2026-09-05T01:20:00.000Z"),
        originalSeriesCode: "FJX",
        series: {
          angle: "0° Straight",
          gender: "Female",
          interfaceFamily: "JIC 37°",
          interfaceStandard: "ISO 8434-2",
          representativeImageReference:
            "hose-end-shape:JIC 37°-Female-Swivel-0° Straight",
          sealingForm: "37° flare",
          seriesCode: "FJX",
          seriesName: "JIC Female Swivel Updated",
          swivelForm: "Swivel",
        },
      });

      const overrideIds = [
        "unused-override-release",
        "override-audit",
        "unused-override-import",
        "override-media-id",
        "unused-override-sku-id",
        "unused-override-variant-id",
      ];
      await maintainHoseEndVariant(repository, {
        actorId: "owner-2",
        generateId: () => overrideIds.shift() ?? "unexpected-override-edit-id",
        imageOverrideReference: "hose-end-shape:JIC 37°-Female-Swivel-45°",
        lifecycleStatus: "discontinued",
        mode: "edit",
        now: () => new Date("2026-09-05T01:30:00.000Z"),
        originalSku: "FJX-04-04",
        variant: { ...variantInput, technicalDataStatus: "Complete" },
      });
      expect(await repository.findHoseEndVariant("FJX-04-04")).toMatchObject({
        imageOverrideReference: "hose-end-shape:JIC 37°-Female-Swivel-45°",
        lifecycleStatus: "discontinued",
        technicalDataStatus: "Complete",
      });

      const inheritIds = [
        "unused-inherit-release",
        "inherit-audit",
        "unused-inherit-import",
        "unused-inherit-media-id",
        "unused-inherit-sku-id",
        "unused-inherit-variant-id",
      ];
      await maintainHoseEndVariant(repository, {
        actorId: "owner-2",
        generateId: () => inheritIds.shift() ?? "unexpected-inherit-edit-id",
        imageOverrideReference: null,
        lifecycleStatus: "draft",
        mode: "edit",
        now: () => new Date("2026-09-05T01:40:00.000Z"),
        originalSku: "FJX-04-04",
        variant: variantInput,
      });

      expect(await repository.findHoseEndSeries("fjx")).toMatchObject({
        seriesCode: "FJX",
        seriesName: "JIC Female Swivel Updated",
      });
      expect(await repository.findHoseEndVariant("fjx-04-04")).toMatchObject({
        fittingSeries: "FJX",
        imageOverrideReference: null,
        lifecycleStatus: "draft",
        sku: "FJX-04-04",
        technicalDataStatus: "Pending",
      });
      expect(
        await platform.env.DB.prepare(
          `SELECT COUNT(*) AS count FROM catalog_product_main_images
           WHERE import_id = 'draft-import' AND sku = 'FJX-04-04'`,
        ).first(),
      ).toEqual({ count: 0 });
      expect(
        await platform.env.DB.prepare(
          `SELECT interface_family, connection_standard, gender, swivel_form,
                  angle, sealing_form
           FROM catalog_hose_ends
           WHERE import_id = 'draft-import' AND sku = 'FJX-04-04'`,
        ).first(),
      ).toEqual({
        angle: "0° Straight",
        connection_standard: "ISO 8434-2",
        gender: "Female",
        interface_family: "JIC 37°",
        sealing_form: "37° flare",
        swivel_form: "Swivel",
      });
      expect(
        await platform.env.DB.prepare(
          `SELECT COUNT(*) AS count FROM catalog_sales_offers
           WHERE import_id = 'draft-import' AND base_sku = 'FJX-04-04'`,
        ).first(),
      ).toEqual({ count: 0 });
      expect(
        await platform.env.DB.prepare(
          `SELECT actor_id, event_type FROM admin_audit_events
           WHERE id IN ('series-audit', 'variant-audit') ORDER BY id`,
        ).all(),
      ).toMatchObject({
        results: [
          {
            actor_id: "owner-1",
            event_type: "catalog_manual.hose_end_series_created",
          },
          {
            actor_id: "owner-1",
            event_type: "catalog_manual.hose_end_variant_created",
          },
        ],
      });
    } finally {
      await platform.dispose();
    }
  }, 60_000);
});
