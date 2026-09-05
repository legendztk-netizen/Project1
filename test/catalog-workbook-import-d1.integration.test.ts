import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterEach, describe, expect, it } from "vitest";

import { importCatalogWorkbook } from "../app/modules/catalog/domain/catalog-workbook-import";
import { createD1CatalogWorkbookImportRepository } from "../app/modules/catalog/infrastructure/d1-catalog-workbook-import-repository";
import { readCatalogWorkbook } from "../app/modules/catalog/infrastructure/read-catalog-workbook";

const projectRoot = join(import.meta.dirname, "..");
const workbookPath = join(
  projectRoot,
  "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function idGenerator(ids: string[]) {
  return () => ids.shift() ?? "unexpected-id";
}

describe("D1 workbook import pending-version isolation", () => {
  it("keeps a failed import out of the current draft and replaces that draft only after a later valid import", async () => {
    const directory = mkdtempSync(join(tmpdir(), "workbook-import-d1-"));
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
      const file = await readFile(workbookPath);
      const sheets = await readCatalogWorkbook(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      );
      const database = platform.env.DB;
      const hoses = sheets.find((sheet) => sheet.sheet === "01_胶管主数据");
      if (!hoses) throw new Error("Missing hose fixture");
      const seriesName = hoses.data[3].length;
      const mainImageReference = seriesName + 1;
      hoses.data[3][seriesName] = "Hose Series Name / 胶管系列名称";
      hoses.data[3][mainImageReference] =
        "Hose Series Main Image Reference / 胶管系列主图引用";
      hoses.data[4][2] = "NEW-R1";
      hoses.data[4][seriesName] = "New R1 Series";
      hoses.data[4][mainImageReference] = "media-version:reviewed-new-r1";
      await database.batch([
        database
          .prepare(
            `INSERT INTO catalog_media_lineages (
               id, logical_reference, created_at, created_by
             ) VALUES (?, ?, ?, ?)`,
          )
          .bind(
            "lineage-new-r1",
            "uploaded:new-r1",
            "2026-09-04T00:59:00.000Z",
            "owner-1",
          ),
        database
          .prepare(
            `INSERT INTO catalog_media_versions (
               id, lineage_id, version, source_kind, approved_reference,
               master_object_key, storefront_object_key, thumbnail_object_key,
               content_hash, mime_type, width, height, created_at, created_by
             ) VALUES (?, ?, 1, 'uploaded', NULL, ?, ?, ?, ?, 'image/webp',
                       1200, 800, ?, ?)`,
          )
          .bind(
            "reviewed-new-r1",
            "lineage-new-r1",
            "catalog/new-r1/master.webp",
            "catalog/new-r1/storefront.webp",
            "catalog/new-r1/thumbnail.webp",
            "hash-new-r1",
            "2026-09-04T00:59:00.000Z",
            "owner-1",
          ),
      ]);
      const repository = createD1CatalogWorkbookImportRepository(database);
      const activeBefore = await database
        .prepare(
          `SELECT release_id, version FROM catalog_active_release WHERE singleton = 1`,
        )
        .first();

      const first = await importCatalogWorkbook(repository, {
        actorId: "owner-1",
        fileName: "catalog-first.xlsx",
        fileSizeBytes: file.byteLength,
        generateId: idGenerator([
          "workbook-import-1",
          "workbook-release-1",
          "workbook-audit-1",
        ]),
        now: () => new Date("2026-09-04T01:00:00.000Z"),
        sheets,
      });
      expect(first.draftReleaseId).toBe("workbook-release-1");
      expect(
        await database
          .prepare(
            `SELECT series_code, series_name, primary_standard,
                    representative_media_version_id
             FROM catalog_hose_series
             WHERE import_id = 'workbook-import-1' AND series_code = '601R1'`,
          )
          .first(),
      ).toMatchObject({
        primary_standard: "SAE 100 R1AT",
        representative_media_version_id: "approved-v1:hose-series:601R1",
        series_code: "601R1",
        series_name: "601R1",
      });
      expect(
        await database
          .prepare(
            `SELECT series_code, series_name, representative_media_version_id
             FROM catalog_hose_series
             WHERE import_id = 'workbook-import-1' AND series_code = 'NEW-R1'`,
          )
          .first(),
      ).toMatchObject({
        representative_media_version_id: "reviewed-new-r1",
        series_code: "NEW-R1",
        series_name: "New R1 Series",
      });
      expect(
        await database
          .prepare(
            `SELECT media_version_id, assignment_kind
             FROM catalog_product_main_images
             WHERE import_id = 'workbook-import-1' AND sku = '601R1_001'`,
          )
          .first(),
      ).toEqual({
        assignment_kind: "inherited",
        media_version_id: "reviewed-new-r1",
      });
      expect(
        await database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM catalog_hose_end_series
             WHERE import_id = 'workbook-import-1'`,
          )
          .first(),
      ).toEqual({ count: 36 });
      expect(
        await database
          .prepare(
            `SELECT DISTINCT assignment_kind
             FROM catalog_product_main_images
             WHERE import_id = 'workbook-import-1'
               AND sku IN ('601R1_001', 'JIC_F_SW_04_04')`,
          )
          .all(),
      ).toMatchObject({ results: [{ assignment_kind: "inherited" }] });

      const invalid = structuredClone(sheets);
      const compatibility = invalid.find(
        (sheet) => sheet.sheet === "04_兼容压接",
      );
      if (!compatibility) throw new Error("Missing compatibility fixture");
      compatibility.data[4][2] = "UNKNOWN_HOSE";
      const failed = await importCatalogWorkbook(repository, {
        actorId: "owner-1",
        fileName: "catalog-invalid.xlsx",
        fileSizeBytes: file.byteLength,
        generateId: idGenerator([
          "workbook-import-failed",
          "workbook-audit-failed",
        ]),
        now: () => new Date("2026-09-04T01:01:00.000Z"),
        sheets: invalid,
      });

      expect(failed).toMatchObject({
        draftReleaseId: null,
        status: "failed",
      });
      expect(
        await database
          .prepare(
            `SELECT id FROM catalog_releases WHERE status = 'draft' ORDER BY id`,
          )
          .all(),
      ).toMatchObject({ results: [{ id: "workbook-release-1" }] });
      expect(
        await database
          .prepare(
            `SELECT release_id, version FROM catalog_active_release WHERE singleton = 1`,
          )
          .first(),
      ).toEqual(activeBefore);

      const second = await importCatalogWorkbook(repository, {
        actorId: "owner-1",
        fileName: "catalog-second.xlsx",
        fileSizeBytes: file.byteLength,
        generateId: idGenerator([
          "workbook-import-2",
          "workbook-release-2",
          "workbook-audit-2",
        ]),
        now: () => new Date("2026-09-04T01:02:00.000Z"),
        sheets,
      });

      expect(second.draftReleaseId).toBe("workbook-release-2");
      expect(
        await database
          .prepare(
            `SELECT id, status FROM catalog_releases
             WHERE id IN ('workbook-release-1', 'workbook-release-2')
             ORDER BY id`,
          )
          .all(),
      ).toMatchObject({
        results: [
          { id: "workbook-release-1", status: "superseded" },
          { id: "workbook-release-2", status: "draft" },
        ],
      });
      expect(
        await repository.findImportReviewById("workbook-import-1"),
      ).toMatchObject({ draftReleaseId: "workbook-release-1" });
      expect(
        await database
          .prepare(
            `SELECT release_id, version FROM catalog_active_release WHERE singleton = 1`,
          )
          .first(),
      ).toEqual(activeBefore);
    } finally {
      await platform.dispose();
    }
  }, 90_000);
});
