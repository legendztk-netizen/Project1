import { describe, expect, it } from "vitest";

import {
  compareDashSizes,
  nominalInchesFromDash,
  normalizeDashSize,
} from "../app/modules/catalog/domain/dash-size";
import {
  displayDash,
  hoseIdLabel,
  hoseSizeLabel,
} from "../app/modules/storefront/domain/variant-label";

describe("storefront Dash size presentation", () => {
  it("removes SKU padding and presents the industry Dash code", () => {
    expect(normalizeDashSize("04")).toBe("-4");
    expect(normalizeDashSize("-06")).toBe("-6");
    expect(displayDash(normalizeDashSize("04"))).toBe("-4");
  });

  it("rejects partial, decimal, and non-positive Dash values", () => {
    expect(normalizeDashSize("4.5")).toBeNull();
    expect(normalizeDashSize("size04")).toBeNull();
    expect(normalizeDashSize("-4abc")).toBeNull();
    expect(normalizeDashSize("0")).toBeNull();
  });

  it("converts hose Dash sizes to customer-readable nominal IDs", () => {
    expect(hoseSizeLabel(0.25, null)).toBe("1/4 in");
    expect(hoseSizeLabel(null, normalizeDashSize("06"))).toBe("3/8 in");
    expect(hoseIdLabel(0.25, null)).toBe("1/4 in hose ID");
    expect(hoseIdLabel(null, normalizeDashSize("06"))).toBe("3/8 in hose ID");
    expect(hoseIdLabel(null, normalizeDashSize("-16"))).toBe("1 in hose ID");
    expect(hoseIdLabel(null, normalizeDashSize("-20"))).toBe(
      "1 1/4 in hose ID",
    );
    expect(hoseIdLabel(null, normalizeDashSize("-40"))).toBe(
      "2 1/2 in hose ID",
    );
    expect(nominalInchesFromDash(normalizeDashSize("-8"))).toBe(0.5);
  });

  it("sorts Dash codes numerically instead of lexically", () => {
    expect(
      ["-12", "-4", "-8"].map(normalizeDashSize).toSorted(compareDashSizes),
    ).toEqual(["-4", "-8", "-12"]);
  });
});
