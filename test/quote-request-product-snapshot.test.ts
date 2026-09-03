import { describe, expect, it } from "vitest";

import {
  captureQuoteRequestProductSnapshot,
  quoteRequestSnapshotVersion,
} from "../app/modules/quote-request/domain/quote-request";
import { publicHoseFixture } from "./fixtures/public-hose";

describe("RFQ product snapshots", () => {
  it("captures product identity, media and parameters without retaining live references", () => {
    const product = publicHoseFixture({
      specs: [
        { label: "Nominal ID", value: "3/16 in" },
        { label: "Working pressure", value: "250 bar" },
      ],
    });

    const snapshot = captureQuoteRequestProductSnapshot(product);
    product.specs[0]!.value = "changed after submission";
    if (product.variantSelection?.kind === "hose") {
      product.variantSelection.nominalIdIn = 99;
    }

    expect(quoteRequestSnapshotVersion).toBe(2);
    expect(snapshot).toMatchObject({
      category: "hydraulic-hose",
      familyName: "601R1 Hydraulic Hose",
      mediaKey: "601R1",
      productType: "hose",
      releaseId: "release-002",
      releaseNumber: "CAT-002",
      specs: [
        { label: "Nominal ID", value: "3/16 in" },
        { label: "Working pressure", value: "250 bar" },
      ],
      variantSelection: {
        dash: "-3",
        kind: "hose",
        nominalIdIn: 0.1875,
      },
    });
  });
});
