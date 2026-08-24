import { Package } from "lucide-react";

import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";

const hoseEndMedia: Record<string, string> = {
  "BSPP-Female-Swivel-0° Straight": "bspp-female-swivel-straight.jpg",
  "BSPP-Female-Swivel-45°": "bspp-female-swivel-45.jpg",
  "BSPP-Female-Swivel-90°": "bspp-female-swivel-90.jpg",
  "BSPP-Male-Fixed-0° Straight": "bspp-male-fixed-straight.jpg",
  "BSPT-Male-Fixed-0° Straight": "bspt-male-fixed-straight.jpg",
  "JIC 37°-Female-Swivel-0° Straight": "jic-female-swivel-straight.jpg",
  "JIC 37°-Female-Swivel-45°": "jic-female-swivel-45.jpg",
  "JIC 37°-Female-Swivel-90°": "jic-female-swivel-90.jpg",
  "JIC 37°-Male-Fixed-0° Straight": "jic-male-fixed-straight.jpg",
  "NPTF-Female-Fixed-0° Straight": "nptf-female-fixed-straight.jpg",
  "NPTF-Male-Fixed-0° Straight": "nptf-male-fixed-straight.jpg",
  "NPTF-Male-Swivel-90°": "nptf-male-swivel-90.jpg",
  "ORFS-Female-Swivel-0° Straight": "orfs-female-swivel-straight.jpg",
  "ORFS-Female-Swivel-45°": "orfs-female-swivel-45.jpg",
  "ORFS-Female-Swivel-90°": "orfs-female-swivel-90.jpg",
  "ORFS-Male-Fixed-0° Straight": "orfs-male-fixed-straight.jpg",
};

export function catalogMediaPath(item: PublicCatalogItem) {
  if (item.productType === "hose" && item.mediaKey) {
    return `/images/catalog/hose/${item.mediaKey}-structure.jpg`;
  }
  if (item.productType === "hose_end" && item.mediaKey) {
    const filename = hoseEndMedia[item.mediaKey];
    return filename ? `/images/catalog/hose-ends/${filename}` : null;
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
