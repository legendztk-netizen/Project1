import { describe, expect, it } from "vitest";

import type { AnonymousQuoteLine } from "../app/modules/quote-list/domain/anonymous-quote-list";
import { quoteLinePreviewParts } from "../app/modules/quote-request/ui/customer-quote-product-preview";

describe("customer quote product previews", () => {
  it("uses the series image for a submitted length-based hose", () => {
    const line = {
      category: "hydraulic-hose",
      displayName: "601R1 Hydraulic Hose -3",
      lineKind: "length_based_hose",
      sku: "601R1_001",
    } as AnonymousQuoteLine;

    expect(quoteLinePreviewParts(line)).toEqual([
      {
        alt: "601R1 hose series",
        kind: "hose",
        src: "/images/catalog/hose/601R1-structure.jpg",
      },
    ]);
  });

  it("uses the immutable configuration snapshot for assembly components", () => {
    const line = {
      category: "hydraulic-hose",
      configuredAssembly: {
        snapshot: {
          configuration: {
            endA: {
              hoseEnd: {
                displayName: "BSPP Female Swivel 0° Straight Hose End",
                mediaKey: "BSPP-Female-Swivel-0° Straight",
              },
            },
            endB: {
              hoseEnd: {
                displayName: "JIC 37° Female Swivel 90° Hose End",
                mediaKey: "JIC 37°-Female-Swivel-90°",
              },
            },
            hose: {
              familyName: "601R2 Hydraulic Hose",
              mediaKey: "601R2",
            },
          },
        },
      },
      displayName: "601R2 Hydraulic Hose Assembly",
      lineKind: "configured_assembly",
      sku: "601R2_002",
    } as unknown as AnonymousQuoteLine;

    expect(quoteLinePreviewParts(line)).toEqual([
      {
        alt: "End A: BSPP Female Swivel 0° Straight Hose End",
        kind: "end",
        src: "/images/catalog/hose-ends/bspp-female-swivel-straight.jpg",
      },
      {
        alt: "601R2 Hydraulic Hose hose",
        kind: "hose",
        src: "/images/catalog/hose/601R2-structure.jpg",
      },
      {
        alt: "End B: JIC 37° Female Swivel 90° Hose End",
        kind: "end",
        src: "/images/catalog/hose-ends/jic-female-swivel-90.jpg",
      },
    ]);
  });

  it("prefers the catalog photos captured with the assembly line", () => {
    const line = {
      category: "hydraulic-hose",
      configuredAssembly: {
        snapshot: {
          configuration: {
            endA: {
              hoseEnd: {
                displayName: "Caterpillar Flange Fixed 45° Hose End",
                mediaKey: "Caterpillar Flange-Fixed-45°",
                sku: "W_CAT45_N_FX_12_12",
              },
            },
            endB: {
              hoseEnd: {
                displayName: "JIC 37° Female Swivel 90° Hose End",
                mediaKey: "JIC 37°-Female-Swivel-90°",
                sku: "W_JIC90_F_SW_12_12",
              },
            },
            hose: {
              familyName: "SAE 100R4 Hydraulic Hose",
              mediaKey: "601R4",
              sku: "601R4_001",
            },
          },
          productBasis: [
            { sku: "601R4_001", mainImageUrl: "/media/catalog/r4/storefront" },
            {
              sku: "W_CAT45_N_FX_12_12",
              mainImageUrl: "/media/catalog/cat45/storefront",
            },
            { sku: "W_JIC90_F_SW_12_12", mainImageUrl: null },
          ],
        },
      },
      displayName: "SAE 100R4 Hydraulic Hose Assembly",
      lineKind: "configured_assembly",
      sku: "601R4_001",
    } as unknown as AnonymousQuoteLine;

    expect(quoteLinePreviewParts(line).map((part) => part.src)).toEqual([
      "/media/catalog/cat45/storefront",
      "/media/catalog/r4/storefront",
      "/images/catalog/hose-ends/jic-female-swivel-90.jpg",
    ]);
  });
});
