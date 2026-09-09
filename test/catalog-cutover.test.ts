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
