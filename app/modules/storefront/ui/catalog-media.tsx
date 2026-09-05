import { Package } from "lucide-react";

import {
  hoseEndMediaPath,
  hoseMediaPath,
  reviewedHoseEndImages,
} from "../../catalog/domain/catalog-main-image";
import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";

function normalizedHoseEndMediaName(value: string) {
  return value
    .replace(/\s+-\d+\s+x\s+-\d+\s*$/u, "")
    .replace(/\s+Hose End\s*$/iu, "")
    .replaceAll("-", " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

const hoseEndMediaByDisplayName = new Map(
  Object.entries(reviewedHoseEndImages).map(([mediaKey, filename]) => [
    normalizedHoseEndMediaName(mediaKey),
    filename,
  ]),
);

export {
  hoseEndMediaPath,
  hoseMediaPath,
} from "../../catalog/domain/catalog-main-image";

export function hoseEndMediaPathFromDisplayName(
  displayName: string | null | undefined,
) {
  if (!displayName) return null;
  const filename = hoseEndMediaByDisplayName.get(
    normalizedHoseEndMediaName(displayName),
  );
  return filename ? `/images/catalog/hose-ends/${filename}` : null;
}

export function catalogMediaPath(item: PublicCatalogItem) {
  if (item.mainImageUrl) return item.mainImageUrl;
  if (item.productType === "hose" && item.mediaKey) {
    return hoseMediaPath(item.mediaKey);
  }
  if (item.productType === "hose_end" && item.mediaKey) {
    return hoseEndMediaPath(item.mediaKey);
  }
  return null;
}

export function CatalogMedia({
  item,
  compact = false,
}: {
  item: PublicCatalogItem;
  compact?: boolean;
}) {
  const path = catalogMediaPath(item);
  if (path) {
    return <img alt={`Representative view of ${item.familyName}`} src={path} />;
  }
  return (
    <div className="catalog-media-fallback" data-compact={compact || undefined}>
      <Package aria-hidden="true" size={compact ? 30 : 52} />
      <span>Technical image pending</span>
    </div>
  );
}
