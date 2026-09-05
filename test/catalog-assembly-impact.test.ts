import { describe, expect, it } from "vitest";

import {
  calculateAssemblyImpact,
  type AssemblyImpactSnapshot,
} from "../app/modules/catalog/domain/catalog-assembly-impact";

function snapshot(): AssemblyImpactSnapshot {
  return {
    compatibilities: [
      {
        compatibilityId: "COMP-A",
        derivationFingerprint: "relationship-a-v1",
        ferruleSku: "FERRULE-SHARED",
        hoseEndSku: "END-SHARED",
        hoseSku: "HOSE-A",
      },
      {
        compatibilityId: "COMP-B",
        derivationFingerprint: "relationship-b-v1",
        ferruleSku: "FERRULE-SHARED",
        hoseEndSku: "END-SHARED",
        hoseSku: "HOSE-B",
      },
    ],
    products: [
      {
        derivationFingerprint: "hose-a-v1",
        hoseSeries: "SERIES-A",
        productType: "hose",
        sku: "HOSE-A",
      },
      {
        derivationFingerprint: "hose-b-v1",
        hoseSeries: "SERIES-B",
        productType: "hose",
        sku: "HOSE-B",
      },
      {
        derivationFingerprint: "end-v1",
        hoseSeries: null,
        productType: "hose_end",
        sku: "END-SHARED",
      },
      {
        derivationFingerprint: "ferrule-v1",
        hoseSeries: null,
        productType: "ferrule",
        sku: "FERRULE-SHARED",
      },
    ],
    sharedDerivationRuleFingerprint: "rule-v1",
  };
}

function copy(value: AssemblyImpactSnapshot): AssemblyImpactSnapshot {
  return structuredClone(value);
}

describe("affected Assembly Series calculation", () => {
  it("marks a directly changed Hose only in its own series", () => {
    const before = snapshot();
    const after = copy(before);
    after.products[0].derivationFingerprint = "hose-a-v2";

    expect(calculateAssemblyImpact(before, after)).toMatchObject({
      affectedSeries: ["SERIES-A"],
      stale: true,
      sourceChanges: [
        {
          affectedSeries: ["SERIES-A"],
          key: "HOSE-A",
          kind: "changed",
          sourceType: "product",
        },
      ],
    });
  });

  it.each([
    ["END-SHARED", "end-v2"],
    ["FERRULE-SHARED", "ferrule-v2"],
  ])(
    "walks shared component dependencies for %s",
    (sku, derivationFingerprint) => {
      const before = snapshot();
      const after = copy(before);
      const product = after.products.find((candidate) => candidate.sku === sku);
      if (!product) throw new Error("Fixture product is missing");
      product.derivationFingerprint = derivationFingerprint;

      expect(calculateAssemblyImpact(before, after).affectedSeries).toEqual([
        "SERIES-A",
        "SERIES-B",
      ]);
    },
  );

  it("retains old dependencies for deletion and replacement SKU changes", () => {
    const before = snapshot();
    const after = copy(before);
    after.products = after.products.filter(
      (product) => product.sku !== "END-SHARED",
    );
    after.products.push({
      derivationFingerprint: "end-replacement-v1",
      hoseSeries: null,
      productType: "hose_end",
      sku: "END-REPLACEMENT",
    });
    after.compatibilities = after.compatibilities.map((relationship) => ({
      ...relationship,
      derivationFingerprint: `${relationship.derivationFingerprint}-replacement`,
      hoseEndSku: "END-REPLACEMENT",
    }));

    const result = calculateAssemblyImpact(before, after);
    expect(result.affectedSeries).toEqual(["SERIES-A", "SERIES-B"]);
    expect(result.sourceChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "END-SHARED", kind: "removed" }),
        expect.objectContaining({ key: "END-REPLACEMENT", kind: "added" }),
      ]),
    );
  });

  it("uses both old and new Hose dependencies when a relationship moves", () => {
    const before = snapshot();
    const after = copy(before);
    const relationship = after.compatibilities[0];
    relationship.hoseSku = "HOSE-B";
    relationship.derivationFingerprint = "relationship-a-v2";

    expect(calculateAssemblyImpact(before, after).affectedSeries).toEqual([
      "SERIES-A",
      "SERIES-B",
    ]);
  });

  it("marks every series after a shared derivation-rule change", () => {
    const before = snapshot();
    const after = copy(before);
    after.sharedDerivationRuleFingerprint = "rule-v2";

    expect(calculateAssemblyImpact(before, after)).toMatchObject({
      affectedSeries: ["SERIES-A", "SERIES-B"],
      stale: true,
      sourceChanges: [
        {
          affectedSeries: ["SERIES-A", "SERIES-B"],
          key: "assembly-component-combination-rules",
          kind: "changed",
          sourceType: "shared_derivation_rule",
        },
      ],
    });
  });

  it("does not mark stale when only non-consumed data changes", () => {
    const before = snapshot();
    const after = copy(before);
    // Prices, Cost Basis, images, Clocking, protection and measurement choices
    // are intentionally absent from the derivation snapshot.

    expect(calculateAssemblyImpact(before, after)).toMatchObject({
      affectedSeries: [],
      sourceChanges: [],
      stale: false,
    });
  });

  it("returns a defensive, sorted set that callers cannot shrink in place", () => {
    const before = snapshot();
    const after = copy(before);
    after.products.find(
      (product) => product.sku === "END-SHARED",
    )!.derivationFingerprint = "end-v2";

    const first = calculateAssemblyImpact(before, after);
    first.affectedSeries.pop();
    const second = calculateAssemblyImpact(before, after);
    expect(second.affectedSeries).toEqual(["SERIES-A", "SERIES-B"]);
  });
});
