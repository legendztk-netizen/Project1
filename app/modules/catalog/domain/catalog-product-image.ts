export const maximumCatalogImageBytes = 12 * 1024 * 1024;
export const maximumCatalogImageDimension = 12_000;
export const maximumCatalogImagePixels = 60_000_000;

export type CatalogImageVariant = "master" | "storefront" | "thumbnail";

export interface CatalogImageInfo {
  format: string;
  height: number;
  width: number;
}

export interface CatalogImageProcessor {
  info(bytes: Uint8Array): Promise<CatalogImageInfo>;
  normalize(
    bytes: Uint8Array,
    options: { height: number; width: number },
  ): Promise<{ bytes: Uint8Array; mimeType: "image/webp" }>;
}

export interface PreparedCatalogImage {
  contentHash: string;
  height: number;
  originalMimeType: string;
  variants: Record<CatalogImageVariant, Uint8Array>;
  width: number;
}

export class CatalogImageRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogImageRejected";
  }
}

function fitWithin(width: number, height: number, maximum: number) {
  const ratio = Math.min(1, maximum / Math.max(width, height));
  return {
    height: Math.max(1, Math.round(height * ratio)),
    width: Math.max(1, Math.round(width * ratio)),
  };
}

function imageMimeType(format: string) {
  const normalized = format
    .toLowerCase()
    .replace(/^image\//u, "")
    .replace("jpg", "jpeg");
  return ["jpeg", "png", "webp"].includes(normalized)
    ? `image/${normalized}`
    : null;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function prepareCatalogImage(
  processor: CatalogImageProcessor,
  bytes: Uint8Array,
): Promise<PreparedCatalogImage> {
  if (bytes.byteLength === 0) {
    throw new CatalogImageRejected("The image file is empty / 图片文件为空");
  }
  if (bytes.byteLength > maximumCatalogImageBytes) {
    throw new CatalogImageRejected(
      "The image exceeds the 12 MB upload limit / 图片超过 12 MB 上传限制",
    );
  }

  let info: CatalogImageInfo;
  try {
    info = await processor.info(bytes);
  } catch {
    throw new CatalogImageRejected(
      "The uploaded bytes are not a supported JPEG, PNG, or WebP image / 上传内容不是受支持的 JPEG、PNG 或 WebP 图片",
    );
  }
  const originalMimeType = imageMimeType(info.format);
  if (!originalMimeType) {
    throw new CatalogImageRejected(
      "Only actual JPEG, PNG, or WebP image content is accepted / 仅接受真实的 JPEG、PNG 或 WebP 图片内容",
    );
  }
  if (
    !Number.isInteger(info.width) ||
    !Number.isInteger(info.height) ||
    info.width < 1 ||
    info.height < 1 ||
    info.width > maximumCatalogImageDimension ||
    info.height > maximumCatalogImageDimension ||
    info.width * info.height > maximumCatalogImagePixels
  ) {
    throw new CatalogImageRejected(
      "Image dimensions are invalid or exceed the 60 megapixel safety limit / 图片尺寸无效或超过 6000 万像素安全限制",
    );
  }

  const sizes = {
    master: fitWithin(info.width, info.height, 2400),
    storefront: fitWithin(info.width, info.height, 1200),
    thumbnail: fitWithin(info.width, info.height, 320),
  } as const;
  try {
    const [master, storefront, thumbnail] = await Promise.all([
      processor.normalize(bytes, sizes.master),
      processor.normalize(bytes, sizes.storefront),
      processor.normalize(bytes, sizes.thumbnail),
    ]);
    return {
      contentHash: await sha256(bytes),
      height: info.height,
      originalMimeType,
      variants: {
        master: master.bytes,
        storefront: storefront.bytes,
        thumbnail: thumbnail.bytes,
      },
      width: info.width,
    };
  } catch {
    throw new CatalogImageRejected(
      "The image could not be normalized; the Catalog draft was not changed / 图片无法标准化，产品目录草稿未更改",
    );
  }
}

export function uploadedCatalogImageReference(mediaVersionId: string) {
  return `media-version:${mediaVersionId}`;
}

export function mediaVersionIdFromReference(reference: string) {
  return reference.startsWith("media-version:")
    ? reference.slice("media-version:".length)
    : null;
}
