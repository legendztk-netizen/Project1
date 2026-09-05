import type { Route } from "./+types/catalog-main-image-resource";
import {
  hoseEndMediaPath,
  hoseMediaPath,
} from "../../catalog/domain/catalog-main-image";
import { cloudflareContext } from "#workers/context";

interface MediaRow {
  approved_reference: string | null;
  master_object_key: string | null;
  storefront_object_key: string | null;
  thumbnail_object_key: string | null;
}

function approvedPath(reference: string) {
  if (reference.startsWith("hose-series:")) {
    return hoseMediaPath(reference.slice("hose-series:".length));
  }
  if (reference.startsWith("hose-end-shape:")) {
    return hoseEndMediaPath(reference.slice("hose-end-shape:".length));
  }
  return null;
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const variant = params.variant;
  if (
    variant !== "master" &&
    variant !== "storefront" &&
    variant !== "thumbnail"
  ) {
    throw new Response("Image variant not found", { status: 404 });
  }
  const { env } = context.get(cloudflareContext);
  const row = await env.DB.prepare(
    `SELECT media.approved_reference, media.master_object_key,
            media.storefront_object_key, media.thumbnail_object_key
     FROM catalog_media_versions media
     WHERE media.id = ?
       AND EXISTS (
         SELECT 1
         FROM catalog_product_main_images assignment
         INNER JOIN catalog_releases release
           ON release.source_import_id = assignment.import_id
         WHERE assignment.media_version_id = media.id
           AND release.status IN ('published', 'superseded')
         UNION ALL
         SELECT 1
         FROM catalog_hose_series series
         INNER JOIN catalog_releases release
           ON release.source_import_id = series.import_id
         WHERE series.representative_media_version_id = media.id
           AND release.status IN ('published', 'superseded')
         UNION ALL
         SELECT 1
         FROM catalog_hose_end_series series
         INNER JOIN catalog_releases release
           ON release.source_import_id = series.import_id
         WHERE series.representative_media_version_id = media.id
           AND release.status IN ('published', 'superseded')
       )`,
  )
    .bind(params.mediaVersionId)
    .first<MediaRow>();
  if (!row) throw new Response("Image not found", { status: 404 });

  if (row.approved_reference) {
    const path = approvedPath(row.approved_reference);
    if (!path)
      throw new Response("Reviewed image source is not web-renderable", {
        status: 404,
      });
    return Response.redirect(new URL(path, request.url), 302);
  }

  const key = {
    master: row.master_object_key,
    storefront: row.storefront_object_key,
    thumbnail: row.thumbnail_object_key,
  }[variant];
  if (!key) throw new Response("Image not found", { status: 404 });
  const object = await env.PRIVATE_FILES.get(key);
  if (!object) throw new Response("Image object not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": object.httpMetadata?.contentType ?? "image/webp",
      ETag: object.httpEtag,
    },
  });
}
