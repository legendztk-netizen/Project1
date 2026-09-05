import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import {
  maintainHoseSeries,
  maintainHoseVariant,
} from "../app/modules/catalog/domain/catalog-hose-maintenance";
import { createD1CatalogManualHoseRepository } from "../app/modules/catalog/infrastructure/d1-catalog-manual-hose-repository";

const projectRoot = join(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("D1 Hose series and variant maintenance", () => {
  it("atomically writes versioned series and inherited-image variant data with audits", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hose-series-variant-d1-"));
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
      await maintainHoseSeries(repository, {
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
          seriesName: "601R1 One-wire Hose",
          tempMaxC: 100,
          tempMinC: -40,
          tubeMaterial: null,
        },
      });

      const variantIds = [
        "unused-release",
        "variant-audit",
        "unused-import",
        "media-assignment-id",
        "sku-id",
        "variant-id",
      ];
      await maintainHoseVariant(repository, {
        actorId: "owner-1",
        generateId: () => variantIds.shift() ?? "unexpected-variant-id",
        imageOverrideReference: null,
        lifecycleStatus: "online",
        mode: "create",
        now: () => new Date("2026-09-05T01:10:00.000Z"),
        originalSku: null,
        variant: {
          bendRadiusMm: 100,
          burstBar: 720,
          dash: "-4",
          hoseSeries: "601R1",
          idMm: 6.4,
          mshaMarking: null,
          nominalIdIn: 0.25,
          notes: "Launch size",
          odMm: 13.4,
          skiveRequirement: null,
          sku: "601R1_TEST_04",
          source: null,
          technicalDataStatus: null,
          weightKgM: 0.2,
          workingBar: 180,
          workingPsi: 2610,
        },
      });

      expect(await repository.findHoseSeries("601r1")).toMatchObject({
        representativeImageReference: "hose-series:601R1",
        seriesCode: "601R1",
        seriesName: "601R1 One-wire Hose",
      });
      expect(await repository.findHoseVariant("601r1_test_04")).toMatchObject({
        hoseSeries: "601R1",
        imageOverrideReference: null,
        lifecycleStatus: "online",
        sku: "601R1_TEST_04",
        technicalDataStatus: "Pending",
      });
      expect(
        await platform.env.DB.prepare(
          `SELECT COUNT(*) AS count FROM catalog_sales_offers
           WHERE import_id = 'draft-import' AND base_sku = '601R1_TEST_04'`,
        ).first(),
      ).toEqual({ count: 0 });
      expect(
        await platform.env.DB.prepare(
          `SELECT COUNT(*) AS count FROM catalog_product_main_images
           WHERE import_id = 'draft-import' AND sku = '601R1_TEST_04'`,
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
            event_type: "catalog_manual.hose_series_created",
          },
          {
            actor_id: "owner-1",
            event_type: "catalog_manual.hose_variant_created",
          },
        ],
      });
    } finally {
      await platform.dispose();
    }
  }, 60_000);
});
