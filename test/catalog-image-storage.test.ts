import { describe, expect, it, vi } from "vitest";

import { createD1R2CatalogImageRepository } from "../app/modules/catalog/infrastructure/d1-r2-catalog-image-repository";

describe("catalog image storage failure isolation", () => {
  it("removes every staged derivative when D1 version registration fails", async () => {
    const put = vi.fn(async () => ({}));
    const remove = vi.fn(async () => undefined);
    const statement = {
      bind() {
        return this;
      },
      async first() {
        return { version: 1 };
      },
    };
    const database = {
      async batch() {
        throw new Error("D1 unavailable");
      },
      prepare: () => statement,
    } as unknown as D1Database;
    const bucket = {
      delete: remove,
      put,
    } as unknown as R2Bucket;

    await expect(
      createD1R2CatalogImageRepository(database, bucket).storeUploadedVersion({
        actorId: "owner-1",
        licenseNotes: null,
        lineageId: null,
        mediaVersionId: "media-1",
        occurredAt: "2026-09-04T00:00:00.000Z",
        prepared: {
          contentHash: "a".repeat(64),
          height: 800,
          originalMimeType: "image/jpeg",
          variants: {
            master: new Uint8Array([1]),
            storefront: new Uint8Array([2]),
            thumbnail: new Uint8Array([3]),
          },
          width: 1200,
        },
        sourceNotes: null,
      }),
    ).rejects.toThrow("D1 unavailable");

    expect(put).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(3);
  });
});
