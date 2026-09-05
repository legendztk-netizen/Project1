import type { PreparedCatalogImage } from "../domain/catalog-product-image";
import { uploadedCatalogImageReference } from "../domain/catalog-product-image";

export interface StoreCatalogImageInput {
  actorId: string;
  licenseNotes: string | null;
  lineageId: string | null;
  mediaVersionId: string;
  occurredAt: string;
  prepared: PreparedCatalogImage;
  sourceNotes: string | null;
}

export function createD1R2CatalogImageRepository(
  database: D1Database,
  bucket: R2Bucket,
) {
  return {
    async storeUploadedVersion(input: StoreCatalogImageInput) {
      const lineageId = input.lineageId ?? crypto.randomUUID();
      const next = await database
        .prepare(
          `SELECT COALESCE(MAX(version), 0) + 1 AS version
           FROM catalog_media_versions WHERE lineage_id = ?`,
        )
        .bind(lineageId)
        .first<{ version: number }>();
      const version = next?.version ?? 1;
      const prefix = `catalog-media/${lineageId}/v${version}-${input.mediaVersionId}`;
      const keys = {
        master: `${prefix}/master.webp`,
        storefront: `${prefix}/storefront.webp`,
        thumbnail: `${prefix}/thumbnail.webp`,
      } as const;
      const written: string[] = [];
      try {
        for (const variant of ["master", "storefront", "thumbnail"] as const) {
          await bucket.put(keys[variant], input.prepared.variants[variant], {
            customMetadata: {
              contentHash: input.prepared.contentHash,
              mediaVersion: String(version),
              variant,
            },
            httpMetadata: { contentType: "image/webp" },
          });
          written.push(keys[variant]);
        }
        await database.batch([
          database
            .prepare(
              `INSERT OR IGNORE INTO catalog_media_lineages (
                 id, logical_reference, created_at, created_by,
                 source_notes, license_notes
               ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              lineageId,
              `uploaded:${lineageId}`,
              input.occurredAt,
              input.actorId,
              input.sourceNotes,
              input.licenseNotes,
            ),
          database
            .prepare(
              `INSERT INTO catalog_media_versions (
                 id, lineage_id, version, source_kind, approved_reference,
                 master_object_key, storefront_object_key, thumbnail_object_key,
                 content_hash, mime_type, width, height, created_at, created_by,
                 source_notes, license_notes
               ) VALUES (?, ?, ?, 'uploaded', NULL, ?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              input.mediaVersionId,
              lineageId,
              version,
              keys.master,
              keys.storefront,
              keys.thumbnail,
              input.prepared.contentHash,
              input.prepared.width,
              input.prepared.height,
              input.occurredAt,
              input.actorId,
              input.sourceNotes,
              input.licenseNotes,
            ),
        ]);
      } catch (error) {
        await Promise.allSettled(written.map((key) => bucket.delete(key)));
        throw error;
      }
      return {
        contentHash: input.prepared.contentHash,
        lineageId,
        mediaVersionId: input.mediaVersionId,
        reference: uploadedCatalogImageReference(input.mediaVersionId),
        version,
      };
    },
  };
}
