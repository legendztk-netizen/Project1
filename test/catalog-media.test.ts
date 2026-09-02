import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { PublicCatalogItem } from "../app/modules/catalog/domain/public-catalog";
import {
  catalogMediaPath,
  hoseEndMediaPathFromDisplayName,
  hoseMediaPath,
} from "../app/modules/storefront/ui/catalog-media";
import { publicHoseFixture } from "./fixtures/public-hose";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

const hoseEndMediaCases = [
  ["BSPP-Female-Swivel-0° Straight", "bspp-female-swivel-straight.jpg"],
  ["JIC 37°-Female-Swivel-0° Straight", "jic-female-swivel-straight.jpg"],
  ["JIC 37°-Female-Swivel-45°", "jic-female-swivel-45.jpg"],
  ["JIC 37°-Female-Swivel-90°", "jic-female-swivel-90.jpg"],
  ["NPTF-Female-Fixed-0° Straight", "nptf-female-fixed-straight.jpg"],
  ["ORFS-Female-Swivel-0° Straight", "orfs-female-swivel-straight.jpg"],
  ["NPTF-Male-Swivel-0° Straight", "nptf-male-swivel-straight.jpg"],
  ["NPSM-Female-Swivel-0° Straight", "npsm-female-swivel-straight.jpg"],
  ["ORB-Male-Fixed-0° Straight", "orb-male-fixed-straight.jpg"],
  ["ORB-Male-Swivel-0° Straight", "orb-male-swivel-straight.jpg"],
  ["ORB-Male-Swivel-90°", "orb-male-swivel-90.jpg"],
  ["SAE Code 61-Fixed-0° Straight", "code-61-straight.jpg"],
  ["SAE Code 61-Fixed-45°", "code-61-45.jpg"],
  ["SAE Code 61-Fixed-90°", "code-61-90.jpg"],
  ["JIC 37°-Female-Swivel-90°-Long", "jic-female-swivel-90-long.jpg"],
  ["JIC 37°-Female-Swivel-90°-Medium", "jic-female-swivel-90-medium.jpg"],
  ["ORFS-Female-Swivel-90°-Long", "orfs-female-swivel-90-long.jpg"],
  ["ORFS-Female-Swivel-90°-Medium", "orfs-female-swivel-90-medium.jpg"],
] as const;

function hoseEndWithMediaKey(mediaKey: string): PublicCatalogItem {
  return publicHoseFixture({
    category: "hose-ends",
    mediaKey,
    productType: "hose_end",
    variantSelection: {
      connectionDash: "-6",
      hoseTailDash: "-6",
      kind: "hose_end",
      thread: null,
    },
  });
}

describe("catalog hose-end media", () => {
  it.each(hoseEndMediaCases)(
    "maps %s to an existing website asset",
    (mediaKey, filename) => {
      const path = catalogMediaPath(hoseEndWithMediaKey(mediaKey));
      expect(path).toBe(`/images/catalog/hose-ends/${filename}`);
      expect(existsSync(`${projectRoot}/public${path}`)).toBe(true);
    },
  );

  it("resolves a submitted hose-end family name without its size suffix", () => {
    expect(
      hoseEndMediaPathFromDisplayName(
        "BSPP Female Swivel 0° Straight Hose End -4 x -4",
      ),
    ).toBe("/images/catalog/hose-ends/bspp-female-swivel-straight.jpg");
  });

  it("only returns hose series images that exist", () => {
    expect(hoseMediaPath("601R1")).toBe(
      "/images/catalog/hose/601R1-structure.jpg",
    );
    expect(hoseMediaPath("UNKNOWN")).toBeNull();
  });
});
