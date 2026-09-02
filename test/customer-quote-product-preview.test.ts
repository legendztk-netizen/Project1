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
});
