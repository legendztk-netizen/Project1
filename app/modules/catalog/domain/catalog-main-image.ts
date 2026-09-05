export const reviewedHoseSeriesImageKeys = [
  "601R1",
  "601R2",
  "EN1SC",
  "EN2SC",
  "EN4SH",
  "EN4SP",
] as const;

const reviewedHoseSeriesImages = new Set<string>(reviewedHoseSeriesImageKeys);

export const reviewedHoseEndImages: Record<string, string> = {
  "BSPP-Female-Swivel-0° Straight": "bspp-female-swivel-straight.jpg",
  "BSPP-Female-Swivel-45°": "bspp-female-swivel-45.jpg",
  "BSPP-Female-Swivel-90°": "bspp-female-swivel-90.jpg",
  "BSPP-Male-Fixed-0° Straight": "bspp-male-fixed-straight.jpg",
  "BSPT-Male-Fixed-0° Straight": "bspt-male-fixed-straight.jpg",
  "JIC 37°-Female-Swivel-0° Straight": "jic-female-swivel-straight.jpg",
  "JIC 37°-Female-Swivel-45°": "jic-female-swivel-45.jpg",
  "JIC 37°-Female-Swivel-90°": "jic-female-swivel-90.jpg",
  "JIC 37°-Female-Swivel-90°-Long": "jic-female-swivel-90-long.jpg",
  "JIC 37°-Female-Swivel-90°-Medium": "jic-female-swivel-90-medium.jpg",
  "JIC 37°-Male-Fixed-0° Straight": "jic-male-fixed-straight.jpg",
  "NPSM-Female-Swivel-0° Straight": "npsm-female-swivel-straight.jpg",
  "NPTF-Female-Fixed-0° Straight": "nptf-female-fixed-straight.jpg",
  "NPTF-Male-Fixed-0° Straight": "nptf-male-fixed-straight.jpg",
  "NPTF-Male-Swivel-0° Straight": "nptf-male-swivel-straight.jpg",
  "NPTF-Male-Swivel-90°": "nptf-male-swivel-90.jpg",
  "ORB-Male-Fixed-0° Straight": "orb-male-fixed-straight.jpg",
  "ORB-Male-Swivel-0° Straight": "orb-male-swivel-straight.jpg",
  "ORB-Male-Swivel-90°": "orb-male-swivel-90.jpg",
  "ORFS-Female-Swivel-0° Straight": "orfs-female-swivel-straight.jpg",
  "ORFS-Female-Swivel-45°": "orfs-female-swivel-45.jpg",
  "ORFS-Female-Swivel-90°": "orfs-female-swivel-90.jpg",
  "ORFS-Female-Swivel-90°-Long": "orfs-female-swivel-90-long.jpg",
  "ORFS-Female-Swivel-90°-Medium": "orfs-female-swivel-90-medium.jpg",
  "ORFS-Male-Fixed-0° Straight": "orfs-male-fixed-straight.jpg",
  "SAE Code 61-Fixed-0° Straight": "code-61-straight.jpg",
  "SAE Code 61-Fixed-45°": "code-61-45.jpg",
  "SAE Code 61-Fixed-90°": "code-61-90.jpg",
};

export const reviewedHoseEndImageKeys = Object.keys(reviewedHoseEndImages);
const reviewedHoseEndImageKeySet = new Set(reviewedHoseEndImageKeys);

export const reviewedFerruleImageReferences = [
  {
    label: "SANF 2022 catalogue ferrule representative · pp. 49-50",
    reference: "catalog-source:62d65f8412ff5.pdf:ferrule:p49-50",
  },
] as const;

export const reviewedAdapterImageReferences = [
  {
    label: "DHH 2404 straight JIC male × NPTF male adapter",
    reference:
      "catalog-source:https://www.discounthydraulichose.com/2404-jic-37-male-x-nptf-male-pipe.html:adapter:straight",
  },
] as const;

export const reviewedQuickCouplerImageReferences = [
  {
    label: "SANF 2022 catalogue quick coupler representative · p. 52",
    reference: "catalog-source:62d65f8412ff5.pdf:quick-coupler:p52",
  },
] as const;

const reviewedFerruleImageReferenceSet = new Set<string>(
  reviewedFerruleImageReferences.map((image) => image.reference),
);
const reviewedAdapterImageReferenceSet = new Set<string>(
  reviewedAdapterImageReferences.map((image) => image.reference),
);
const reviewedQuickCouplerImageReferenceSet = new Set<string>(
  reviewedQuickCouplerImageReferences.map((image) => image.reference),
);

export function hoseMainImageReference(hoseSeries: string) {
  return reviewedHoseSeriesImages.has(hoseSeries)
    ? `hose-series:${hoseSeries}`
    : null;
}

export function hoseSeriesFromMainImageReference(reference: string) {
  const prefix = "hose-series:";
  if (!reference.startsWith(prefix)) return null;
  const hoseSeries = reference.slice(prefix.length);
  return reviewedHoseSeriesImages.has(hoseSeries) ? hoseSeries : null;
}

export function hoseEndMainImageReference(mediaKey: string) {
  return reviewedHoseEndImageKeySet.has(mediaKey)
    ? `hose-end-shape:${mediaKey}`
    : null;
}

export function hoseEndMainImageReferenceFromFields(input: {
  angle: string;
  connectionStandard: string;
  fittingSeries: string;
  gender: string;
  interfaceFamily: string;
  swivelForm: string;
}) {
  const code = input.fittingSeries.trim().split(/\s+/u, 1)[0]?.toUpperCase();
  const interfaceName =
    code === "FPX" || input.connectionStandard.includes("NPSM")
      ? "NPSM"
      : code?.startsWith("C61")
        ? "SAE Code 61"
        : input.interfaceFamily;
  const lengthClass =
    code === "FJX90L" || code === "FFX90L"
      ? "Long"
      : code === "FJX90M" || code === "FFX90M"
        ? "Medium"
        : null;
  return `hose-end-shape:${[
    interfaceName,
    input.gender === "N/A" ? null : input.gender,
    input.swivelForm,
    input.angle,
    lengthClass,
  ]
    .filter(Boolean)
    .join("-")}`;
}

export function hoseEndMediaKeyFromMainImageReference(reference: string) {
  const prefix = "hose-end-shape:";
  if (!reference.startsWith(prefix)) return null;
  const mediaKey = reference.slice(prefix.length);
  return reviewedHoseEndImageKeySet.has(mediaKey) ? mediaKey : null;
}

export function ferruleMainImageReference(reference: string) {
  return reviewedFerruleImageReferenceSet.has(reference) ? reference : null;
}

export function adapterMainImageReference(reference: string) {
  return reviewedAdapterImageReferenceSet.has(reference) ? reference : null;
}

export function quickCouplerMainImageReference(reference: string) {
  return reviewedQuickCouplerImageReferenceSet.has(reference)
    ? reference
    : null;
}

export function isUploadedMainImageReference(reference: string) {
  return /^media-version:[A-Za-z0-9_-]+$/u.test(reference);
}

export function publicCatalogMainImageUrl(
  mediaVersionId: string | null | undefined,
  approvedReference: string | null | undefined,
) {
  if (!mediaVersionId) return null;
  if (approvedReference) {
    if (approvedReference.startsWith("hose-series:")) {
      if (!hoseMediaPath(approvedReference.slice("hose-series:".length))) {
        return null;
      }
    } else if (approvedReference.startsWith("hose-end-shape:")) {
      if (
        !hoseEndMediaPath(approvedReference.slice("hose-end-shape:".length))
      ) {
        return null;
      }
    } else {
      return null;
    }
  }
  return `/media/catalog/${encodeURIComponent(mediaVersionId)}/storefront`;
}

export function hoseMediaPath(hoseSeries: string | null | undefined) {
  if (!hoseSeries || !reviewedHoseSeriesImages.has(hoseSeries)) return null;
  return `/images/catalog/hose/${hoseSeries}-structure.jpg`;
}

export function hoseEndMediaPath(mediaKey: string | null | undefined) {
  if (!mediaKey) return null;
  const filename = reviewedHoseEndImages[mediaKey];
  return filename ? `/images/catalog/hose-ends/${filename}` : null;
}
