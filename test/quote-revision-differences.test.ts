import { expect, it } from "vitest";
import type { QuoteRequestSnapshot } from "../app/modules/quote-request/domain/quote-request";
import { quoteRevisionDifferences } from "../app/modules/quote-review/domain/quote-revision-differences";
import {
  reviseQuoteLine,
  type ReviewedQuoteLine,
} from "../app/modules/quote-review/domain/quote-line-revision";
import { commercialTerms } from "./fixtures/quote-commercial";
const source = {
  lines: [
    {
      id: "a",
      sku: "A",
      displayName: "Product A",
      lineKind: "standard",
      quantity: 2,
      salesUnit: "EA",
      lengthOrder: null,
      productSnapshot: {
        familyName: "Family A",
        specs: [{ label: "Size", value: "1/4 in" }],
        offer: { hiddenSentinel: "PRIVATE-PRICE-SENTINEL" },
      },
    },
    {
      id: "b",
      sku: "B",
      displayName: "Product B",
      lineKind: "standard",
      quantity: 3,
      salesUnit: "EA",
      lengthOrder: null,
      productSnapshot: { familyName: "Family B", specs: [] },
    },
  ],
} as unknown as QuoteRequestSnapshot;
const material = () => ({
  source: structuredClone(source),
  terms: commercialTerms(),
  prices: [
    { unitPriceCents: 100, discountBasisPoints: 0 },
    { unitPriceCents: 200, discountBasisPoints: 0 },
  ],
});

it("ignores line reordering with corresponding prices and internal-only changes", () => {
  const before = material(),
    after = material();
  after.source.lines.reverse();
  after.prices.reverse();
  after.terms.taxEvidenceId = "PRIVATE-TAX-SENTINEL";
  after.terms.addressReplacementReason = "PRIVATE-NOTE-SENTINEL";
  expect(quoteRevisionDifferences(before, after)).toEqual([]);
});
it("projects specification differences through explicit customer-safe fields", () => {
  const before = material(),
    after = material();
  after.source.lines[0].productSnapshot.specs[0].value = "3/8 in";
  const changes = quoteRevisionDifferences(before, after);
  expect(changes.map((change) => change.field)).toEqual(["Specifications"]);
  expect(JSON.stringify(changes)).toContain("3/8 in");
  expect(JSON.stringify(changes)).not.toMatch(/PRIVATE|offer|catalogBasis/);
});
it("detects other fees and packing changes as material", () => {
  const before = material(),
    after = material();
  after.terms.charges.insurance = 500;
  after.terms.packingEstimate = "Revised: 3 cartons, 25kg gross";
  expect(
    quoteRevisionDifferences(before, after).map((change) => change.field),
  ).toEqual(["Other charges", "Packing estimate"]);
});
it("omits nested configuration metadata from customer specification differences", () => {
  const before = material(),
    after = material();
  const assembly = {
    id: "assembly",
    sku: "HOSE",
    lineKind: "configured_assembly",
    quantity: 1,
    configuredAssembly: {
      snapshot: {
        configuration: {
          hose: { sku: "HOSE", familyName: "Test hose" },
          finishedLength: { originalValue: "30", originalUnit: "in" },
          lengthReferencePricing: {
            privateSentinel: "PRIVATE-ASSEMBLY-SENTINEL",
          },
          internalNotes: "PRIVATE-INTERNAL-NOTE",
        },
      },
    },
  };
  before.source.lines = [assembly] as unknown as QuoteRequestSnapshot["lines"];
  after.source.lines = structuredClone(before.source.lines);
  if (after.source.lines[0].lineKind === "configured_assembly")
    after.source.lines[0].configuredAssembly.snapshot.configuration.finishedLength!.originalValue =
      "40";
  before.prices = [before.prices[0]];
  after.prices = [after.prices[0]];
  const changes = quoteRevisionDifferences(before, after);
  expect(changes.map((change) => change.field)).toContain("Specifications");
  expect(JSON.stringify(changes)).not.toMatch(
    /PRIVATE|lengthReferencePricing|internalNotes/,
  );
});
it("allows bounded named amendments but rejects overriding structured fields through free text", () => {
  const line = source.lines[0] as ReviewedQuoteLine;
  const input = {
    id: "a",
    sku: "A",
    quantity: 5,
    lengthValue: "",
    lengthUnit: "ft" as const,
    specifications: [{ label: "Marking", value: "Batch B" }],
  };
  const revised = reviseQuoteLine(line, input, null);
  expect(revised.quantity).toBe(5);
  expect(revised.quotedSpecificationOverrides).toEqual(input.specifications);
  expect(line.quantity).toBe(2);
  expect(() =>
    reviseQuoteLine(
      line,
      {
        ...input,
        specifications: [{ label: "Finished length", value: "40 in" }],
      },
      null,
    ),
  ).toThrow(/structured/);
});
