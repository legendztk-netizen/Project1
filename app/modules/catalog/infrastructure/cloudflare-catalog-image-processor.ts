import type {
  CatalogImageInfo,
  CatalogImageProcessor,
} from "../domain/catalog-product-image";

function bytesStream(bytes: Uint8Array) {
  return new Blob([Uint8Array.from(bytes).buffer]).stream();
}

export function createCloudflareCatalogImageProcessor(
  images: ImagesBinding,
): CatalogImageProcessor {
  return {
    async info(bytes) {
      const info = await images.info(bytesStream(bytes));
      if (!("width" in info) || !("height" in info)) {
        throw new Error("Vector images are not accepted");
      }
      return {
        format: String(info.format),
        height: Number(info.height),
        width: Number(info.width),
      } satisfies CatalogImageInfo;
    },
    async normalize(bytes, options) {
      const output = await images
        .input(bytesStream(bytes))
        .transform({
          fit: "scale-down",
          height: options.height,
          width: options.width,
        })
        .output({ format: "image/webp", quality: 85 });
      return {
        bytes: new Uint8Array(await output.response().arrayBuffer()),
        mimeType: "image/webp" as const,
      };
    },
  };
}
