import { describe, expect, it } from "vitest";

import {
  inferProductLifecycleStatus,
  productLifecycleState,
} from "../app/modules/catalog/domain/catalog-product-lifecycle";

describe("catalog product lifecycle", () => {
  it.each([
    ["online", "Published", "Eligible", "available_for_quote"],
    ["draft", "Draft", "Eligible", "temporarily_unavailable"],
    ["discontinued", "Archived", "Blocked", "discontinued"],
  ] as const)(
    "maps %s to one coherent product, price, and availability state",
    (status, publication, rfq, availability) => {
      expect(productLifecycleState(status)).toEqual({
        catalogPublicationStatus: publication,
        rfqEligibility: rfq,
        supplyAvailability: availability,
      });
      expect(
        inferProductLifecycleStatus({
          catalogPublicationStatus: publication,
          supplyAvailability: availability,
        }),
      ).toBe(status);
    },
  );
});
