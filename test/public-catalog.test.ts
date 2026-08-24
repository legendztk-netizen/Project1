import { describe, expect, it } from "vitest";

import {
  groupCatalogFamilies,
  interfaceGroup,
  matchesCatalogQuery,
} from "../app/modules/catalog/domain/public-catalog";
import { publicCatalogItemFromRow } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";

function hoseEnd(overrides: Record<string, unknown> = {}) {
  return publicCatalogItemFromRow({
    adapter_family_id: null,
    angle: "Straight",
    body_size: null,
    catalog_model: null,
    connection_dash: "-6",
    connection_form_1: null,
    connection_form_2: null,
    connection_standard: "SAE J514",
    competitor_part_number: "10643-6-6",
    coupler_series: null,
    currency: "USD",
    dash: null,
    equivalent_standard: null,
    ferrule_series: null,
    fluid_compatibility: null,
    gender: "Female",
    hose_construction: null,
    hose_series: null,
    hose_tail_dash: "-6",
    interchange_standard: null,
    interface_1: null,
    interface_2: null,
    interface_family: "JIC",
    lead_time_days: 10,
    max_working_bar: 350,
    moq: 1,
    nominal_id_in: null,
    port_gender: null,
    port_interface: null,
    port_thread: null,
    primary_standard: null,
    product_type: "hose_end",
    quantity_input_mode: "unit",
    reference_price_usd: 8.5,
    reinforcement: null,
    release_id: "release-1",
    release_number: "CAT-001",
    rfq_eligibility: "Eligible",
    role: null,
    sales_unit: "each",
    sealing_form: "37° flare",
    shape_code: null,
    size_1: null,
    size_2: null,
    sku: "JIC_F_SW_06_06",
    skive_requirement: null,
    supply_availability: "available_for_quote",
    swivel_form: "Swivel",
    thread: "9/16-18 UNF",
    website_product_name: null,
    working_bar: null,
    working_psi: null,
    ...overrides,
  } as never);
}

describe("public catalog read model", () => {
  it("groups size variants without losing exact SKU selection", () => {
    const variants = [
      hoseEnd(),
      hoseEnd({
        connection_dash: "-8",
        hose_tail_dash: "-8",
        sku: "JIC_F_SW_08_08",
      }),
    ];
    const families = groupCatalogFamilies(variants);
    expect(families).toHaveLength(1);
    expect(families[0]?.variants.map((variant) => variant.sku)).toEqual([
      "JIC_F_SW_06_06",
      "JIC_F_SW_08_08",
    ]);
  });

  it("keeps exact connection standards searchable", () => {
    const item = hoseEnd({
      connection_standard: "NPTF SAE J476",
      interface_family: "NPTF",
    });
    expect(matchesCatalogQuery(item, "NPTF")).toBe(true);
    expect(matchesCatalogQuery(item, "SAE J476")).toBe(true);
    expect(item.specs).toContainEqual({
      label: "Connection standard",
      value: "NPTF SAE J476",
    });
  });

  it("searches imported competitor aliases without exposing them as identity", () => {
    const item = hoseEnd({ competitor_part_number: "FBSPX-04-04W" });
    expect(matchesCatalogQuery(item, "FBSPX-04-04W")).toBe(true);
    expect(item.aliases).toContain("FBSPX-04-04W");
    expect(item.displayName).not.toContain("FBSPX-04-04W");
  });

  it("uses customer interface groups without collapsing exact standards", () => {
    expect(interfaceGroup("JIC")).toBe("JIC 37°");
    expect(interfaceGroup("NPTF")).toBe("NPT / NPTF");
    expect(interfaceGroup("BSPP")).toBe("BSPP / BSPT");
    expect(interfaceGroup("BSPT")).toBe("BSPP / BSPT");
  });

  it("keeps grouped interface labels separate from exact product families", () => {
    const variants = [
      hoseEnd({
        connection_standard: "ASME B1.20.1 NPT",
        interface_family: "NPT",
        sealing_form: "Tapered thread",
        sku: "NPT_M_FX_04_04",
        thread: "1/4-18 NPT",
      }),
      hoseEnd({
        connection_standard: "SAE J476 NPTF",
        interface_family: "NPTF",
        sealing_form: "Dryseal tapered thread",
        sku: "NPTF_M_FX_04_04",
        thread: "1/4-18 NPTF",
      }),
      hoseEnd({
        connection_standard: "ISO 1179 / ISO 228-1",
        interface_family: "BSPP",
        sealing_form: "60° cone seat",
        sku: "BSPP_F_SW_04_04",
        thread: "G 1/4-19",
      }),
      hoseEnd({
        connection_standard: "ISO 7-1",
        interface_family: "BSPT",
        sealing_form: "Tapered thread",
        sku: "BSPT_M_FX_04_04",
        thread: "R 1/4-19",
      }),
    ];

    const families = groupCatalogFamilies(variants);
    expect(families).toHaveLength(4);
    expect(variants.map((variant) => variant.interfaceGroup)).toEqual([
      "NPT / NPTF",
      "NPT / NPTF",
      "BSPP / BSPT",
      "BSPP / BSPT",
    ]);
    expect(variants.map((variant) => variant.familyKey)).toEqual([
      "npt-female-swivel-straight",
      "nptf-female-swivel-straight",
      "bspp-female-swivel-straight",
      "bspt-female-swivel-straight",
    ]);
    expect(variants.map((variant) => variant.specs[1]?.value)).toEqual([
      "ASME B1.20.1 NPT",
      "SAE J476 NPTF",
      "ISO 1179 / ISO 228-1",
      "ISO 7-1",
    ]);
  });

  it("only enables Add to Quote for eligible available products", () => {
    expect(hoseEnd().canAddToQuote).toBe(true);
    expect(
      hoseEnd({ supply_availability: "temporarily_unavailable" }).canAddToQuote,
    ).toBe(false);
    expect(hoseEnd({ rfq_eligibility: "Manual Review" }).canAddToQuote).toBe(
      false,
    );
  });
});
