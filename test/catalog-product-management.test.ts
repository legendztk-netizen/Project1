import { describe, expect, it } from "vitest";
import {
  selectionActions,
  paginateProductGroups,
  validateProductPackaging,
} from "../app/modules/catalog/domain/catalog-product-management";
describe("product management rules", () => {
  it("never turns a series selection into selected children", () => {
    expect(selectionActions([{ kind: "series", code: "S" }])).toEqual({
      edit: true,
      delete: true,
    });
    expect(
      selectionActions([
        { kind: "sku", code: "A" },
        { kind: "sku", code: "B" },
      ]),
    ).toEqual({ edit: false, delete: true });
    expect(
      selectionActions([
        { kind: "series", code: "S" },
        { kind: "sku", code: "A" },
      ]),
    ).toEqual({ edit: false, delete: false });
  });
  it("paginates top-level groups without counting expanded children", () => {
    const groups = Array.from({ length: 51 }, (_, i) => ({
      code: String(i),
      children: Array(40).fill("sku"),
    }));
    expect(paginateProductGroups(groups, 2, 20).items).toEqual(
      groups.slice(20, 40),
    );
    expect(paginateProductGroups(groups, 2, 50).items).toHaveLength(1);
  });
  it("uses packaging applicability for all five product types", () => {
    expect(() =>
      validateProductPackaging(
        "hose",
        {
          salesUnit: "ft",
          quantityInputMode: "Length x Pieces",
          minimumLengthPerPieceFt: 1,
          lengthIncrementFt: 1,
        },
        null,
      ),
    ).not.toThrow();
    expect(() =>
      validateProductPackaging(
        "hose",
        { salesUnit: "roll", quantityInputMode: "Quantity" },
        null,
      ),
    ).toThrow();
    for (const type of [
      "hose_end",
      "ferrule",
      "adapter",
      "quick_coupler",
    ] as const) {
      expect(() => validateProductPackaging(type, null, 10)).toThrow();
      expect(() => validateProductPackaging(type, null, null)).not.toThrow();
    }
  });
});

it("labels every product parameter in both languages", async () => {
  const { productFields } =
    await import("../app/modules/catalog/domain/catalog-product-fields");
  for (const type of [
    "hose",
    "hose_end",
    "ferrule",
    "adapter",
    "quick_coupler",
  ] as const) {
    for (const kind of ["series", "sku"] as const) {
      for (const field of productFields(type, kind))
        expect(field.header, `${type}.${kind}.${field.key}`).toMatch(
          /[\u4e00-\u9fff]/,
        );
    }
  }
});
