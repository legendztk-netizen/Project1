import { describe, expect, it } from "vitest";

import {
  connectorInterfaceName,
  connectorThread,
} from "../app/modules/catalog/domain/connector-thread";
import { groupCatalogFamilies } from "../app/modules/catalog/domain/public-catalog";
import { publicCatalogItemFromRow } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import {
  chooseStageValue,
  resolvedStageVariant,
  resolveVariantStages,
  stageValuesOf,
  variantStageAxes,
} from "../app/modules/storefront/domain/staged-variant-selection";

function row(overrides: Record<string, unknown>) {
  return publicCatalogItemFromRow({
    currency: "USD",
    lead_time_days: 10,
    moq: 1,
    quantity_input_mode: "unit",
    reference_price_usd: 4.5,
    release_id: "release-1",
    release_number: "CAT-001",
    rfq_eligibility: "Eligible",
    sales_unit: "each",
    supply_availability: "available_for_quote",
    ...overrides,
  } as never);
}

function adapter(size1: string, size2: string, interface2 = "NPT") {
  return row({
    adapter_family_id: `ADP_FAM_JIC_${interface2}_ST`,
    catalog_model: `2404-${size1}-${size2}`,
    connection_form_1: "M",
    connection_form_2: "M",
    interface_1: "JIC",
    interface_2: interface2,
    product_type: "adapter",
    shape_code: "ST",
    size_1: size1,
    size_2: size2,
    sku: `ADP_ST_JIC_M_${size1.slice(1).padStart(2, "0")}_${interface2}_M_${size2.slice(1).padStart(2, "0")}`,
    website_product_name: null,
  });
}

function coupler(
  role: string,
  roleCode: string,
  body: string,
  port: string,
  portThread: string,
  portInterface = "NPTF",
  series = "ISO 16028 Flat Face",
) {
  return row({
    body_dash: body,
    body_size: { "06": "3/8 in", "08": "1/2 in" }[body] ?? null,
    connection_mechanism: "Sleeve lock / push-to-connect",
    coupler_series: series,
    interchange_standard: series.split(" ").slice(0, 2).join(" "),
    port_dash: port,
    port_gender: "Female",
    port_interface: portInterface,
    port_thread: portThread,
    product_type: "quick_coupler",
    role,
    sku: `QDC_16028_${roleCode}_${body}_F${portInterface}_${port}`,
    valving: "Flat face / double shut-off",
  });
}

describe("connector threads", () => {
  it("reads JIC and ORB threads from their shared chart column", () => {
    expect(connectorThread("JIC", "-4")).toBe("7/16-20 UNF");
    expect(connectorThread("ORB", "-4")).toBe("7/16-20 UNF");
    expect(connectorThread("JIC", "-14")).toBe("1-3/16-12 UN");
    expect(connectorThread("ORB", "-32")).toBe("2-1/2-12 UN");
  });

  it("reads pipe and face-seal threads by their own series", () => {
    expect(connectorThread("NPT", "-6")).toBe("3/8-18 NPTF");
    expect(connectorThread("NPTF", "-16")).toBe("1-11.5 NPTF");
    expect(connectorThread("ORFS", "-4")).toBe("9/16-18 UNF");
    expect(connectorThread("ORFS", "-10")).toBe("1-14 UNS");
  });

  it("returns no thread for sizes a series does not define", () => {
    expect(connectorThread("NPT", "-10")).toBeNull();
    expect(connectorThread("ORFS", "-2")).toBeNull();
    expect(connectorThread("BSPP", "-4")).toBeNull();
    expect(connectorThread("JIC", null)).toBeNull();
  });

  it("names interfaces for customers, with pipe ends as NPTF", () => {
    expect(connectorInterfaceName("JIC")).toBe("JIC 37°");
    expect(connectorInterfaceName("NPT")).toBe("NPTF");
    expect(connectorInterfaceName("Metric")).toBe("Metric");
  });
});

describe("adapter catalog items", () => {
  it("describe both ends with interface, form, thread and Dash", () => {
    const item = adapter("-4", "-6");
    expect(item.familyName).toBe("Straight Male JIC 37° to Male NPTF Adapter");
    expect(item.variantSelection).toEqual({
      ends: [
        {
          dash: "-4",
          form: "Male",
          interfaceName: "JIC 37°",
          thread: "7/16-20 UNF",
        },
        {
          dash: "-6",
          form: "Male",
          interfaceName: "NPTF",
          thread: "3/8-18 NPTF",
        },
      ],
      kind: "adapter",
    });
    expect(item.specs.slice(0, 2).map((spec) => spec.value)).toEqual([
      "Male JIC 37°",
      "Male NPTF",
    ]);
    expect(item.specs).toContainEqual({
      label: "End 2 thread",
      value: "3/8-18 NPTF",
    });
  });
});

describe("quick coupler catalog items", () => {
  it("group every part and port of one interchange series on one page", () => {
    const families = groupCatalogFamilies([
      coupler("Coupler/Socket", "SOC", "08", "08", "1/2-14 NPTF"),
      coupler("Plug/Nipple", "PLG", "08", "08", "1/2-14 NPTF"),
      coupler("Complete Pair", "SET", "08", "12", "3/4-14 NPTF"),
      coupler(
        "Plug/Nipple",
        "PLG",
        "08",
        "08",
        "1/2-14 NPTF",
        "NPTF",
        "ISO 5675 Agricultural",
      ),
    ]);
    expect(
      families.map((family) => [family.familyKey, family.variants.length]),
    ).toEqual([
      ["iso-16028-flat-face", 3],
      ["iso-5675-agricultural", 1],
    ]);
    expect(families[0]?.familyName).toBe("ISO 16028 Flat Face Quick Couplers");
    expect(families[0]?.interfaceGroup).toBe("ISO 16028");
  });

  it("name the part the US way without changing the stored role", () => {
    const nipple = coupler("Plug/Nipple", "PLG", "08", "08", "1/2-14 NPTF");
    const set = coupler("Complete Pair", "SET", "08", "12", "3/4-14 NPTF");
    expect(nipple.displayName).toBe(
      "ISO 16028 Flat Face Nipple, 1/2 in body, 1/2-14 NPTF female port",
    );
    expect(set.displayName).toBe(
      "ISO 16028 Flat Face Coupler + Nipple Set, 1/2 in body, 3/4-14 NPTF female ports",
    );
    expect(nipple.specs.slice(0, 2).map((spec) => spec.value)).toEqual([
      "ISO 16028",
      "Flat face / double shut-off",
    ]);
    expect(nipple.variantSelection).toMatchObject({
      bodyDash: "-8",
      kind: "quick_coupler",
      portDash: "-8",
      role: "Plug/Nipple",
    });
  });
});

describe("staged variant selection", () => {
  const adapters = [
    adapter("-2", "-2"),
    adapter("-4", "-2"),
    adapter("-4", "-6"),
    adapter("-8", "-6"),
    adapter("-8", "-8"),
  ];
  const adapterAxes = variantStageAxes("adapter")!;

  it("offers each end's sizes in Dash order and waits at the first open stage", () => {
    const stages = resolveVariantStages(adapters, adapterAxes, []);
    expect(stages).toHaveLength(1);
    expect(stages[0]?.options.map((option) => option.value)).toEqual([
      "-2",
      "-4",
      "-8",
    ]);
    expect(stages[0]?.selected).toBeNull();
  });

  it("offers only the second-end sizes made with the chosen first end", () => {
    const stages = resolveVariantStages(adapters, adapterAxes, ["-4"]);
    expect(stages[1]?.options.map((option) => option.value)).toEqual([
      "-2",
      "-6",
    ]);
    expect(resolvedStageVariant(stages, adapterAxes.length)).toBeNull();
  });

  it("selects a sole remaining size without a click", () => {
    const stages = resolveVariantStages(adapters, adapterAxes, ["-2"]);
    expect(stages[1]?.selected).toBe("-2");
    expect(resolvedStageVariant(stages, adapterAxes.length)?.sku).toBe(
      "ADP_ST_JIC_M_02_NPT_M_02",
    );
  });

  it("treats a choice that no longer exists as unchosen", () => {
    const stages = resolveVariantStages(adapters, adapterAxes, ["-8", "-2"]);
    expect(stages[1]?.selected).toBeNull();
  });

  it("restores the choices of a requested SKU", () => {
    const variant = adapters[3]!;
    const stages = resolveVariantStages(
      adapters,
      adapterAxes,
      stageValuesOf(variant, adapterAxes),
    );
    expect(resolvedStageVariant(stages, adapterAxes.length)?.sku).toBe(
      variant.sku,
    );
  });

  it("keeps Hose End steps explicit even when one size remains", () => {
    const axes = variantStageAxes("hose_end")!;
    expect(axes.every((axis) => !axis.autoSelectSingle)).toBe(true);
    expect(variantStageAxes("ferrule")).toBeNull();
  });

  it("keeps automatic selections when a later stage is clicked", () => {
    const axes = variantStageAxes("quick_coupler")!;
    const ag = "ISO 5675 Agricultural";
    const variants = [
      coupler("Coupler/Socket", "SOC", "08", "08", "1/2-14 NPTF", "NPTF", ag),
      coupler("Plug/Nipple", "PLG", "08", "08", "1/2-14 NPTF", "NPTF", ag),
      coupler("Coupler/Socket", "SOC", "08", "08", "3/4-16 UNF-2B", "ORB", ag),
    ];
    // The sole body size is selected automatically, so the first click is on the port stage.
    const opening = resolveVariantStages(variants, axes, []);
    const port = chooseStageValue(opening, 1, "-8|ORB|Female");
    const afterPort = resolveVariantStages(variants, axes, port);
    expect(resolvedStageVariant(afterPort, axes.length)?.sku).toBe(
      "QDC_16028_SOC_08_FORB_08",
    );
    // An NPTF port is followed by an explicit part choice.
    const nptf = resolveVariantStages(
      variants,
      axes,
      chooseStageValue(opening, 1, "-8|NPTF|Female"),
    );
    const part = chooseStageValue(nptf, 2, "Plug/Nipple");
    expect(
      resolvedStageVariant(
        resolveVariantStages(variants, axes, part),
        axes.length,
      )?.sku,
    ).toBe("QDC_16028_PLG_08_FNPTF_08");
  });

  it("clears later choices when an earlier stage changes", () => {
    const stages = resolveVariantStages(adapters, adapterAxes, ["-4", "-6"]);
    expect(chooseStageValue(stages, 0, "-8")).toEqual(["-8"]);
  });

  it("tells same-Dash quick coupler ports apart and lists parts coupler first", () => {
    const axes = variantStageAxes("quick_coupler")!;
    const ag = "ISO 5675 Agricultural";
    const variants = [
      coupler("Complete Pair", "SET", "08", "08", "1/2-14 NPTF", "NPTF", ag),
      coupler("Plug/Nipple", "PLG", "08", "08", "1/2-14 NPTF", "NPTF", ag),
      coupler("Coupler/Socket", "SOC", "08", "08", "1/2-14 NPTF", "NPTF", ag),
      coupler("Coupler/Socket", "SOC", "08", "08", "3/4-16 UNF-2B", "ORB", ag),
    ];
    const ports = resolveVariantStages(variants, axes, []);
    expect(ports[0]?.selected).toBe("-8");
    expect(ports[1]?.options.map((option) => option.value)).toEqual([
      "-8|NPTF|Female",
      "-8|ORB|Female",
    ]);
    const parts = resolveVariantStages(variants, axes, [
      "-8",
      "-8|NPTF|Female",
    ]);
    expect(parts[2]?.options.map((option) => option.value)).toEqual([
      "Coupler/Socket",
      "Plug/Nipple",
      "Complete Pair",
    ]);
    const orb = resolveVariantStages(variants, axes, ["-8", "-8|ORB|Female"]);
    expect(resolvedStageVariant(orb, axes.length)?.sku).toBe(
      "QDC_16028_SOC_08_FORB_08",
    );
  });
});
