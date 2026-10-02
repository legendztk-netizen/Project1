import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { createD1CatalogCutover } from "../app/modules/catalog/infrastructure/d1-catalog-cutover";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import {
  createD1R2CatalogImageRepository,
  storeItemMainImage,
} from "../app/modules/catalog/infrastructure/d1-r2-catalog-image-repository";
import type { CatalogImageProcessor } from "../app/modules/catalog/domain/catalog-product-image";

const root = join(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "catalog-item-image-d1-"));
let platform: Awaited<
  ReturnType<
    typeof getPlatformProxy<{ DB: D1Database; PRIVATE_FILES: R2Bucket }>
  >
>;
let db: D1Database;
let bucket: R2Bucket;
const actor = {
  id: "owner-1",
  accountType: "owner",
  catalogPermission: "edit",
};

const prepared = (hash: string) => ({
  contentHash: hash.repeat(64).slice(0, 64),
  height: 10,
  width: 12,
  originalMimeType: "image/png",
  variants: {
    master: new Uint8Array([1, 1]),
    storefront: new Uint8Array([2, 2]),
    thumbnail: new Uint8Array([3, 3]),
  },
});
const store = (id: string, hash = "a") =>
  createD1R2CatalogImageRepository(db, bucket).storeUploadedVersion({
    actorId: actor.id,
    licenseNotes: null,
    lineageId: null,
    mediaVersionId: id,
    occurredAt: "2026-10-02T00:00:00.000Z",
    prepared: prepared(hash),
    sourceNotes: "test",
  });
const fakeProcessor: CatalogImageProcessor = {
  info: async () => ({ format: "png", width: 12, height: 10 }),
  normalize: async (_bytes, options) => ({
    bytes: new Uint8Array([9, options.width, options.height]),
    mimeType: "image/webp",
  }),
};

beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{
    DB: D1Database;
    PRIVATE_FILES: R2Bucket;
  }>({
    configPath: join(root, "wrangler.jsonc"),
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  bucket = platform.env.PRIVATE_FILES;
  await seedManagedAssemblyBaseline(db);
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("lets administrators add item images after the cutover while the cutover freeze and legacy tables stay closed", async () => {
  const cutover = createD1CatalogCutover(db, actor);
  const run = await cutover.inventory("image-upload");
  await cutover.freeze(run.id);
  await expect(store("frozen-upload")).rejects.toThrow(/frozen/);
  expect(
    await db
      .prepare("SELECT 1 FROM catalog_media_versions WHERE id='frozen-upload'")
      .first(),
  ).toBeNull();

  await cutover.commit(run.id);
  const stored = await store("after-cutover");
  expect(stored.reference).toBe("media-version:after-cutover");
  const row = await db
    .prepare(
      "SELECT source_kind, storefront_object_key, created_by FROM catalog_media_versions WHERE id='after-cutover'",
    )
    .first<{
      source_kind: string;
      storefront_object_key: string;
      created_by: string;
    }>();
  expect(row).toMatchObject({ source_kind: "uploaded", created_by: "owner-1" });
  expect(await bucket.get(row!.storefront_object_key)).not.toBeNull();

  // Published/immutable media and every other legacy table remain write-protected.
  await expect(
    db
      .prepare(
        "UPDATE catalog_media_versions SET width=1 WHERE id='after-cutover'",
      )
      .run(),
  ).rejects.toThrow();
  await expect(
    db
      .prepare("DELETE FROM catalog_media_versions WHERE id='after-cutover'")
      .run(),
  ).rejects.toThrow();
  await expect(
    db
      .prepare(
        "INSERT INTO catalog_imports(id,kind,status,created_at) VALUES('late-import','workbook','pending','2026-10-02')",
      )
      .run(),
  ).rejects.toThrow(/frozen/);
}, 60000);

it("applies an uploaded image to an item through the normal item edit command", async () => {
  const items = createD1CatalogItemRepository(db);
  const payload = (await items.findPayload("sku", "601R1_001"))!;
  payload.mediaVersionId = "after-cutover";
  const result = await items.apply({
    payload,
    targetState: "online",
    mode: "edit",
    commandId: "image-upload-edit-601R1_001",
    actorId: actor.id,
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  const revision = await db
    .prepare(
      "SELECT media_version_id FROM catalog_product_revisions WHERE id=?",
    )
    .bind(result.revisionId)
    .first<{ media_version_id: string }>();
  expect(revision?.media_version_id).toBe("after-cutover");
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual(
    [],
  );
}, 60000);

it("normalizes and stores an uploaded file as a new media version", async () => {
  const id = await storeItemMainImage(
    { database: db, bucket, processor: fakeProcessor },
    {
      bytes: new Uint8Array([137, 80, 78, 71]),
      actorId: actor.id,
      sourceNotes: "from the item editor",
      licenseNotes: null,
    },
  );
  const row = await db
    .prepare(
      "SELECT lineage_id, version, source_kind, mime_type, width, height, source_notes, storefront_object_key FROM catalog_media_versions WHERE id=?",
    )
    .bind(id)
    .first<Record<string, unknown>>();
  expect(row).toMatchObject({
    version: 1,
    source_kind: "uploaded",
    mime_type: "image/webp",
    width: 12,
    height: 10,
    source_notes: "from the item editor",
  });
  expect(
    await (await bucket.get(
      row!.storefront_object_key as string,
    ))!.arrayBuffer(),
  ).toBeInstanceOf(ArrayBuffer);
  await expect(
    storeItemMainImage(
      {
        database: db,
        bucket,
        processor: {
          ...fakeProcessor,
          info: async () => {
            throw new Error("not an image");
          },
        },
      },
      {
        bytes: new Uint8Array([1, 2, 3]),
        actorId: actor.id,
        sourceNotes: null,
        licenseNotes: null,
      },
    ),
  ).rejects.toThrow(/JPEG, PNG, or WebP/);
}, 60000);
