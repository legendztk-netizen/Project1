import { describe, expect, it } from "vitest";

import {
  itemCompatibilityKey,
  normalizeItemPrice,
} from "../app/modules/catalog/domain/catalog-item-publication";

describe("item publication contracts", () => {
  it("retains a price's original currency without converting it", () => {
    expect(
      normalizeItemPrice({
        amount: 28.5,
        currency: "CNY",
        packageLengthFt: null,
      }),
    ).toEqual({ amount: 28.5, currency: "CNY", packageLengthFt: null });
    expect(() =>
      normalizeItemPrice({
        amount: -1,
        currency: "USD",
        packageLengthFt: null,
      }),
    ).toThrow();
    expect(() =>
      normalizeItemPrice({ amount: 2, currency: "BAD", packageLengthFt: null }),
    ).toThrow();
  });

  it("invalidates only existing compatibility keys and availability", () => {
    const before = {
      hoseSeries: "601R1",
      dash: "-4",
      skiveRequirement: "No Skive",
      state: "online",
      workingBar: 180,
      price: 4,
    };
    const priceAndPressureChange = { ...before, workingBar: 200, price: 8 };
    expect(itemCompatibilityKey(before)).toBe(
      itemCompatibilityKey(priceAndPressureChange),
    );
    expect(itemCompatibilityKey(before)).not.toBe(
      itemCompatibilityKey({ ...before, dash: "-6" }),
    );
    expect(itemCompatibilityKey(before)).not.toBe(
      itemCompatibilityKey({ ...before, state: "discontinued" }),
    );
  });
});
