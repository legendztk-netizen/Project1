import { expect, it } from "vitest";
import {
  draftDifference,
  canonicalJson,
} from "../app/modules/catalog/domain/catalog-cutover";
it("does not turn inherited old values into reversions of a newer Active", () => {
  expect(draftDifference({ price: 1 }, { price: 1 }, { price: 2 }, true)).toBe(
    "inherited",
  );
  expect(draftDifference({ price: 1 }, { price: 3 }, { price: 2 }, true)).toBe(
    "changed",
  );
  expect(draftDifference(null, { price: 1 }, { price: 2 }, false)).toBe(
    "ambiguous",
  );
  expect(draftDifference({ price: 1 }, null, { price: 1 }, true)).toBe(
    "ambiguous_deletion",
  );
  expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
});

it("retains an adapter family with no child SKU and detects family-only edits", async () => {
  const { releaseProducts } =
    await import("../app/modules/catalog/domain/catalog-cutover");
  const family = {
    adapter_family_id: "AF",
    website_product_name: "Adapter family",
    notes: "Original",
    catalog_publication_status: "Published",
    rfq_eligibility: "Eligible",
  };
  const before = releaseProducts({ catalog_adapter_families: [family] });
  const after = releaseProducts({
    catalog_adapter_families: [{ ...family, notes: "Changed" }],
  });
  expect(before).toHaveLength(1);
  expect(before[0].key).toBe("series:adapter:AF");
  expect(before[0].targetState).toBe("online");
  expect(
    draftDifference(
      before[0].payload,
      after[0].payload,
      before[0].payload,
      true,
    ),
  ).toBe("changed");
});
