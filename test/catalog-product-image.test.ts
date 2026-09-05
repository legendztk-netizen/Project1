import { describe, expect, it, vi } from "vitest";

import {
  CatalogImageRejected,
  prepareCatalogImage,
  type CatalogImageProcessor,
} from "../app/modules/catalog/domain/catalog-product-image";

function processor(overrides: Partial<CatalogImageProcessor> = {}) {
  const normalize = vi.fn(async (_bytes: Uint8Array, options) => ({
    bytes: new TextEncoder().encode(
      `normalized-${options.width}x${options.height}`,
    ),
    mimeType: "image/webp" as const,
  }));
  return {
    implementation: {
      info: async () => ({ format: "jpeg", height: 2000, width: 4000 }),
      normalize,
      ...overrides,
    } satisfies CatalogImageProcessor,
    normalize,
  };
}

describe("catalog product image preparation", () => {
  it("checks decoded content and creates non-cropped master, storefront and thumbnail WebP derivatives", async () => {
    const fake = processor();
    const prepared = await prepareCatalogImage(
      fake.implementation,
      new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
    );

    expect(fake.normalize.mock.calls.map((call) => call[1])).toEqual([
      { height: 1200, width: 2400 },
      { height: 600, width: 1200 },
      { height: 160, width: 320 },
    ]);
    expect(new TextDecoder().decode(prepared.variants.storefront)).toBe(
      "normalized-1200x600",
    );
    expect(prepared.originalMimeType).toBe("image/jpeg");
    expect(prepared.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects renamed non-image bytes using processor content inspection", async () => {
    const fake = processor({
      info: async () => {
        throw new Error("not an image");
      },
    });
    await expect(
      prepareCatalogImage(
        fake.implementation,
        new TextEncoder().encode("fake.jpg"),
      ),
    ).rejects.toBeInstanceOf(CatalogImageRejected);
    expect(fake.normalize).not.toHaveBeenCalled();
  });

  it("rejects unsafe dimensions before writing any derivative", async () => {
    const fake = processor({
      info: async () => ({ format: "png", height: 10_000, width: 10_000 }),
    });
    await expect(
      prepareCatalogImage(fake.implementation, new Uint8Array([1, 2, 3])),
    ).rejects.toThrow("60 megapixel");
    expect(fake.normalize).not.toHaveBeenCalled();
  });

  it("reports normalization failure without returning partial variants", async () => {
    const fake = processor({
      normalize: async () => {
        throw new Error("transform unavailable");
      },
    });
    await expect(
      prepareCatalogImage(fake.implementation, new Uint8Array([1, 2, 3])),
    ).rejects.toThrow("Catalog draft was not changed");
  });
});
