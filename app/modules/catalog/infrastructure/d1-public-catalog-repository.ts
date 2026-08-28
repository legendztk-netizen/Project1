import {
  categoryByProductType,
  groupCatalogFamilies,
  interfaceGroup,
  matchesCatalogQuery,
  slug,
  type PublicCatalogFamily,
  type PublicCatalogItem,
  type PublicCatalogSpec,
  type PublicProductType,
} from "../domain/public-catalog";
import type { CatalogFamilyId } from "../domain/catalog-family";
import { normalizeDashSize } from "../domain/dash-size";

interface PublicCatalogRow {
  adapter_family_id: string | null;
  angle: string | null;
  bend_radius_mm: number | null;
  body_material: string | null;
  body_size: string | null;
  burst_bar: number | null;
  catalog_model: string | null;
  connection_dash: string | null;
  connection_form_1: string | null;
  connection_form_2: string | null;
  connection_mechanism: string | null;
  connection_standard: string | null;
  competitor_part_number: string | null;
  coupler_coating: string | null;
  coupler_series: string | null;
  cover_color: string | null;
  cover_finish: string | null;
  cover_material: string | null;
  currency: string | null;
  cutting_labeling_fee_rate: number | null;
  cutting_labeling_fee_scope: string | null;
  cutting_labeling_fee_version: number | null;
  cutoff_b_mm: number | null;
  dash: string | null;
  dimension_a_mm: number | null;
  equivalent_standard: string | null;
  ferrule_coating: string | null;
  ferrule_material: string | null;
  ferrule_series: string | null;
  fluid_compatibility: string | null;
  fitting_series: string | null;
  gender: string | null;
  hex_1_mm: number | null;
  hex_2_mm: number | null;
  hose_construction: string | null;
  hose_end_coating: string | null;
  hose_end_material: string | null;
  hose_series: string | null;
  hose_tail_dash: string | null;
  id_mm: number | null;
  interchange_standard: string | null;
  interface_1: string | null;
  interface_2: string | null;
  interface_family: string | null;
  lead_time_days: number | null;
  length_increment_ft: number | null;
  hose_end_max_working_bar: number | null;
  hose_end_unit_weight_g: number | null;
  hose_temp_max_c: number | null;
  hose_temp_min_c: number | null;
  hose_weight_kg_m: number | null;
  coupler_max_working_bar: number | null;
  coupler_temp_max_c: number | null;
  coupler_temp_min_c: number | null;
  coupler_unit_weight_g: number | null;
  minimum_bore_mm: number | null;
  minimum_burst_bar: number | null;
  minimum_length_per_piece_ft: number | null;
  moq: number | null;
  nominal_id_in: number | null;
  od_mm: number | null;
  overall_length_mm: number | null;
  port_gender: string | null;
  port_interface: string | null;
  port_thread: string | null;
  primary_standard: string | null;
  product_type: PublicProductType;
  preset_length_1_ft: number | null;
  preset_length_2_ft: number | null;
  preset_length_3_ft: number | null;
  quantity_input_mode: string | null;
  rated_flow_l_min: number | null;
  reference_price_usd: number | null;
  reinforcement: string | null;
  release_id: string;
  release_number: string;
  rfq_eligibility: PublicCatalogItem["rfqEligibility"];
  role: string | null;
  sales_unit: string | null;
  seal_material: string | null;
  sealing_form: string | null;
  shape_code: string | null;
  size_1: string | null;
  size_2: string | null;
  sku: string;
  skive_requirement: string | null;
  supply_availability: PublicCatalogItem["supplyAvailability"];
  swivel_form: string | null;
  thread: string | null;
  tube_material: string | null;
  valving: string | null;
  website_product_name: string | null;
  working_bar: number | null;
  working_psi: number | null;
}

function compactSpecs(entries: Array<[string, unknown]>): PublicCatalogSpec[] {
  return entries.flatMap(([label, value]) =>
    value === null || value === undefined || value === ""
      ? []
      : [{ label, value: String(value) }],
  );
}

function hoseEndLengthClass(fittingSeries: string | null) {
  const code = fittingSeries?.trim().split(/\s+/, 1)[0]?.toUpperCase();
  if (code === "FJX90L" || code === "FFX90L") return "Long";
  if (code === "FJX90M" || code === "FFX90M") return "Medium";
  return null;
}

function hoseEndInterface(row: PublicCatalogRow) {
  const seriesCode = row.fitting_series
    ?.trim()
    .split(/\s+/, 1)[0]
    ?.toUpperCase();
  if (seriesCode === "FPX" || row.connection_standard?.includes("NPSM")) {
    return "NPSM";
  }
  if (seriesCode?.startsWith("C61")) return "SAE Code 61";
  return row.interface_family ?? "Hose End";
}

function buildPublicCatalogPresentation(row: PublicCatalogRow) {
  if (row.product_type === "hose") {
    const series = row.hose_series ?? row.sku.split("_")[0];
    return {
      aliases: [row.primary_standard, row.equivalent_standard, row.dash],
      displayName: `${series} Hydraulic Hose ${row.dash ?? ""}`.trim(),
      familyKey: slug(series),
      familyName: `${series} Hydraulic Hose`,
      interface: null,
      mediaKey: series,
      specs: compactSpecs([
        ["Primary standard", row.primary_standard],
        ["Equivalent standard", row.equivalent_standard],
        ["Hose dash", row.dash],
        ["Nominal ID", row.nominal_id_in ? `${row.nominal_id_in} in` : null],
        ["Working pressure", row.working_bar ? `${row.working_bar} bar` : null],
        ["Working pressure", row.working_psi ? `${row.working_psi} psi` : null],
        ["Reinforcement", row.reinforcement],
        ["Tube material", row.tube_material],
        [
          "Cover",
          [row.cover_material, row.cover_color, row.cover_finish]
            .filter(Boolean)
            .join(" · "),
        ],
        ["Outside diameter", row.od_mm ? `${row.od_mm} mm` : null],
        [
          "Minimum bend radius",
          row.bend_radius_mm ? `${row.bend_radius_mm} mm` : null,
        ],
        [
          "Minimum burst pressure",
          row.burst_bar ? `${row.burst_bar} bar` : null,
        ],
        [
          "Temperature range",
          row.hose_temp_min_c != null && row.hose_temp_max_c != null
            ? `${row.hose_temp_min_c}°C to ${row.hose_temp_max_c}°C`
            : null,
        ],
        [
          "Weight",
          row.hose_weight_kg_m ? `${row.hose_weight_kg_m} kg/m` : null,
        ],
        ["Fluid compatibility", row.fluid_compatibility],
      ]),
    };
  }
  if (row.product_type === "hose_end") {
    const exactInterface = hoseEndInterface(row);
    const lengthClass = hoseEndLengthClass(row.fitting_series);
    const displayGender = row.gender === "N/A" ? null : row.gender;
    const familyName = [
      exactInterface,
      displayGender,
      row.swivel_form,
      row.angle,
      lengthClass,
      "Hose End",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      aliases: [
        row.fitting_series,
        row.connection_standard,
        row.competitor_part_number,
        row.sealing_form,
        row.thread,
        row.connection_dash,
        row.hose_tail_dash,
      ],
      displayName: `${familyName} ${row.connection_dash ?? ""} x ${row.hose_tail_dash ?? ""}`,
      familyKey: slug(
        [exactInterface, displayGender, row.swivel_form, row.angle, lengthClass]
          .filter(Boolean)
          .join("-"),
      ),
      familyName,
      interface: exactInterface,
      mediaKey: [
        exactInterface,
        displayGender,
        row.swivel_form,
        row.angle,
        lengthClass,
      ]
        .filter(Boolean)
        .join("-"),
      specs: compactSpecs([
        ["Interface family", exactInterface],
        ["Connection standard", row.connection_standard],
        ["Thread", row.thread],
        ["Sealing form", row.sealing_form],
        ["Connection dash", row.connection_dash],
        ["Hose tail dash", row.hose_tail_dash],
        ["Gender", row.gender],
        ["Form", row.swivel_form],
        ["Angle", row.angle],
        ["Length profile", lengthClass],
        ["Material", row.hose_end_material],
        ["Coating", row.hose_end_coating],
        [
          "Maximum working pressure",
          row.hose_end_max_working_bar
            ? `${row.hose_end_max_working_bar} bar`
            : null,
        ],
        ["Dimension A", row.dimension_a_mm ? `${row.dimension_a_mm} mm` : null],
        ["Cutoff B", row.cutoff_b_mm ? `${row.cutoff_b_mm} mm` : null],
        ["Hex 1", row.hex_1_mm ? `${row.hex_1_mm} mm` : null],
        ["Hex 2", row.hex_2_mm ? `${row.hex_2_mm} mm` : null],
        [
          "Minimum bore",
          row.minimum_bore_mm ? `${row.minimum_bore_mm} mm` : null,
        ],
        [
          "Unit weight",
          row.hose_end_unit_weight_g ? `${row.hose_end_unit_weight_g} g` : null,
        ],
      ]),
    };
  }
  if (row.product_type === "ferrule") {
    const familyName = `${row.ferrule_series ?? "Hydraulic"} ${row.hose_construction ?? ""} Ferrule`;
    return {
      aliases: [
        row.hose_construction,
        row.hose_tail_dash,
        row.skive_requirement,
      ],
      displayName: `${familyName} ${row.hose_tail_dash ?? ""}`,
      familyKey: slug(
        [row.ferrule_series, row.hose_construction, row.skive_requirement]
          .filter(Boolean)
          .join("-"),
      ),
      familyName,
      interface: null,
      mediaKey: null,
      specs: compactSpecs([
        ["Ferrule series", row.ferrule_series],
        ["Hose construction", row.hose_construction],
        ["Hose tail dash", row.hose_tail_dash],
        ["Skive requirement", row.skive_requirement],
        ["Material", row.ferrule_material],
        ["Coating", row.ferrule_coating],
      ]),
    };
  }
  if (row.product_type === "adapter") {
    const familyName = [
      row.shape_code === "ST" ? "Straight" : row.shape_code,
      row.interface_1,
      "to",
      row.interface_2,
      "Adapter",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      aliases: [
        row.website_product_name,
        row.catalog_model,
        row.interface_1,
        row.interface_2,
        row.connection_form_1,
        row.connection_form_2,
        row.size_1,
        row.size_2,
      ],
      displayName:
        row.website_product_name ??
        `${familyName} ${row.size_1} x ${row.size_2}`,
      familyKey: slug(row.adapter_family_id ?? familyName),
      familyName,
      interface: row.interface_1,
      mediaKey: null,
      specs: compactSpecs([
        ["Interface 1", row.interface_1],
        ["Connection form 1", row.connection_form_1],
        ["Size 1", row.size_1],
        ["Interface 2", row.interface_2],
        ["Connection form 2", row.connection_form_2],
        ["Size 2", row.size_2],
        ["Catalog model", row.catalog_model],
      ]),
    };
  }
  const familyName = `${row.coupler_series ?? "Hydraulic"} ${row.role ?? "Quick Coupler"}`;
  return {
    aliases: [
      row.interchange_standard,
      row.body_size,
      row.port_interface,
      row.port_gender,
      row.port_thread,
    ],
    displayName:
      `${familyName} ${row.body_size ?? ""} ${row.port_thread ?? ""}`.trim(),
    familyKey: slug(
      [row.coupler_series, row.role, row.port_interface, row.port_gender]
        .filter(Boolean)
        .join("-"),
    ),
    familyName,
    interface: row.port_interface,
    mediaKey: null,
    specs: compactSpecs([
      ["Interchange standard", row.interchange_standard],
      ["Role", row.role],
      ["Body size", row.body_size],
      ["Port interface", row.port_interface],
      ["Port gender", row.port_gender],
      ["Port thread", row.port_thread],
      ["Connection mechanism", row.connection_mechanism],
      ["Valving", row.valving],
      ["Body material", row.body_material],
      ["Coating", row.coupler_coating],
      ["Seal material", row.seal_material],
      [
        "Maximum working pressure",
        row.coupler_max_working_bar
          ? `${row.coupler_max_working_bar} bar`
          : null,
      ],
      [
        "Minimum burst pressure",
        row.minimum_burst_bar ? `${row.minimum_burst_bar} bar` : null,
      ],
      [
        "Rated flow",
        row.rated_flow_l_min ? `${row.rated_flow_l_min} L/min` : null,
      ],
      [
        "Temperature range",
        row.coupler_temp_min_c != null && row.coupler_temp_max_c != null
          ? `${row.coupler_temp_min_c}°C to ${row.coupler_temp_max_c}°C`
          : null,
      ],
      [
        "Overall length",
        row.overall_length_mm ? `${row.overall_length_mm} mm` : null,
      ],
      [
        "Unit weight",
        row.coupler_unit_weight_g ? `${row.coupler_unit_weight_g} g` : null,
      ],
    ]),
  };
}

export function publicCatalogItemFromRow(
  row: PublicCatalogRow,
): PublicCatalogItem {
  const product = buildPublicCatalogPresentation(row);
  const madeToOrder = (row.quantity_input_mode ?? "")
    .toLocaleLowerCase()
    .includes("length");
  const presets = [
    row.preset_length_1_ft,
    row.preset_length_2_ft,
    row.preset_length_3_ft,
  ].filter((value): value is number => value !== null && value > 0);
  const lengthOrdering =
    madeToOrder &&
    row.minimum_length_per_piece_ft !== null &&
    row.length_increment_ft !== null &&
    row.cutting_labeling_fee_rate !== null &&
    row.cutting_labeling_fee_scope !== null &&
    row.cutting_labeling_fee_version !== null
      ? {
          cuttingLabelingFee: {
            currency: "USD" as const,
            ratePerPiece: row.cutting_labeling_fee_rate,
            scope: row.cutting_labeling_fee_scope,
            version: row.cutting_labeling_fee_version,
          },
          incrementFt: row.length_increment_ft,
          minimumLengthFt: row.minimum_length_per_piece_ft,
          presetsFt: presets,
          unit: "ft" as const,
        }
      : null;
  return {
    aliases: product.aliases.filter((value): value is string => Boolean(value)),
    canAddToQuote:
      row.rfq_eligibility === "Eligible" &&
      row.supply_availability === "available_for_quote",
    category: categoryByProductType[row.product_type],
    displayName: product.displayName,
    familyKey: product.familyKey,
    familyName: product.familyName,
    interfaceGroup: interfaceGroup(product.interface),
    mediaKey: product.mediaKey,
    offer:
      row.sales_unit && row.lead_time_days !== null && row.moq !== null
        ? {
            currency: row.currency ?? "USD",
            leadTimeDays: row.lead_time_days,
            lengthOrdering,
            madeToOrder,
            moq: row.moq,
            referencePrice: row.reference_price_usd,
            salesUnit: row.sales_unit,
          }
        : null,
    productType: row.product_type,
    releaseId: row.release_id,
    releaseNumber: row.release_number,
    rfqEligibility: row.rfq_eligibility,
    sku: row.sku,
    specs: product.specs,
    supplyAvailability: row.supply_availability,
    variantSelection:
      row.product_type === "hose"
        ? {
            dash: normalizeDashSize(row.dash),
            equivalentStandard: row.equivalent_standard,
            hoseSeries: row.hose_series ?? row.sku.split("_")[0] ?? row.sku,
            kind: "hose",
            nominalIdIn: row.nominal_id_in,
            performance: {
              temperatureMaxC: row.hose_temp_max_c,
              temperatureMinC: row.hose_temp_min_c,
              workingBar: row.working_bar,
              workingPsi: row.working_psi,
            },
            primaryStandard: row.primary_standard,
            reinforcement: row.reinforcement,
          }
        : row.product_type === "hose_end"
          ? {
              connectionDash: normalizeDashSize(row.connection_dash),
              hoseTailDash: normalizeDashSize(row.hose_tail_dash),
              kind: "hose_end",
              thread: row.thread,
            }
          : null,
  };
}

const publicCatalogSql = `
  SELECT r.id AS release_id, r.release_number, s.sku, s.product_type, s.hose_series,
         s.rfq_eligibility, s.supply_availability,
         o.sales_unit, o.moq, o.lead_time_days, o.currency,
         o.reference_price_usd, o.quantity_input_mode,
         o.minimum_length_per_piece_ft, o.length_increment_ft,
         o.preset_length_1_ft, o.preset_length_2_ft, o.preset_length_3_ft,
         COALESCE(series_fee.rate_per_piece, global_fee.rate_per_piece) AS cutting_labeling_fee_rate,
         COALESCE(series_fee.scope_key, global_fee.scope_key) AS cutting_labeling_fee_scope,
         COALESCE(series_fee.version, global_fee.version) AS cutting_labeling_fee_version,
         h.primary_standard, h.equivalent_standard, h.dash,
         h.nominal_id_in, h.id_mm, h.od_mm, h.working_bar, h.working_psi,
         h.burst_bar, h.bend_radius_mm,
         h.weight_kg_m AS hose_weight_kg_m,
         h.temp_min_c AS hose_temp_min_c,
         h.temp_max_c AS hose_temp_max_c, h.tube_material,
         h.reinforcement, h.cover_material, h.cover_color, h.cover_finish,
         h.fluid_compatibility,
         e.fitting_series, e.competitor_part_number, e.interface_family,
         e.connection_standard, e.gender,
         e.swivel_form, e.angle, e.sealing_form, e.thread,
         e.connection_dash, e.hose_tail_dash,
         e.material AS hose_end_material, e.coating AS hose_end_coating,
         e.max_working_bar AS hose_end_max_working_bar,
         e.dimension_a_mm, e.cutoff_b_mm,
         e.hex_1_mm, e.hex_2_mm, e.minimum_bore_mm,
         e.unit_weight_g AS hose_end_unit_weight_g,
         f.ferrule_series, f.hose_construction,
         f.hose_tail_dash AS ferrule_hose_tail_dash,
         f.skive_requirement, f.material AS ferrule_material,
         f.coating AS ferrule_coating,
         a.adapter_family_id, a.catalog_model, a.website_product_name,
         a.shape_code, a.interface_1, a.connection_form_1, a.size_1,
         a.interface_2, a.connection_form_2, a.size_2,
         q.coupler_series, q.role, q.interchange_standard, q.body_size,
         q.port_interface, q.port_gender, q.port_thread,
         q.connection_mechanism, q.valving, q.body_material,
         q.coating AS coupler_coating, q.seal_material,
         q.max_working_bar AS coupler_max_working_bar,
         q.minimum_burst_bar, q.rated_flow_l_min,
         q.temp_min_c AS coupler_temp_min_c,
         q.temp_max_c AS coupler_temp_max_c,
         q.overall_length_mm,
         q.unit_weight_g AS coupler_unit_weight_g
  FROM catalog_active_release ar
  INNER JOIN catalog_releases r ON r.id = ar.release_id
  INNER JOIN catalog_skus s ON s.import_id = r.source_import_id
  LEFT JOIN catalog_sales_offers o
    ON o.import_id = s.import_id AND o.base_sku = s.sku
  LEFT JOIN cutting_labeling_fee_rates global_fee
    ON global_fee.scope_key = 'global'
  LEFT JOIN cutting_labeling_fee_rates series_fee
    ON series_fee.scope_key = 'series:' || s.hose_series
  LEFT JOIN catalog_hose_variants h
    ON h.import_id = s.import_id AND h.sku = s.sku
  LEFT JOIN catalog_hose_ends e
    ON e.import_id = s.import_id AND e.sku = s.sku
  LEFT JOIN catalog_ferrules f
    ON f.import_id = s.import_id AND f.sku = s.sku
  LEFT JOIN catalog_adapters a
    ON a.import_id = s.import_id AND a.sku = s.sku
  LEFT JOIN catalog_quick_couplers q
    ON q.import_id = s.import_id AND q.sku = s.sku
  WHERE ar.singleton = 1
    AND r.status = 'published'
    AND s.catalog_publication_status = 'Published'
  ORDER BY s.product_type, s.sku`;

function normalizeFerrule(
  row: PublicCatalogRow & { ferrule_hose_tail_dash?: string | null },
) {
  if (row.product_type === "ferrule") {
    row.hose_tail_dash = row.ferrule_hose_tail_dash ?? row.hose_tail_dash;
  }
  return row;
}

export function createD1PublicCatalogRepository(database: D1Database) {
  async function allItems() {
    const rows = await database
      .prepare(publicCatalogSql)
      .all<PublicCatalogRow & { ferrule_hose_tail_dash?: string | null }>();
    return rows.results.map(normalizeFerrule).map(publicCatalogItemFromRow);
  }

  return {
    async browse(input: {
      category?: CatalogFamilyId | null;
      query?: string | null;
    }) {
      const items = (await allItems()).filter(
        (item) =>
          (!input.category || item.category === input.category) &&
          matchesCatalogQuery(item, input.query ?? ""),
      );
      return { families: groupCatalogFamilies(items), items };
    },
    async findFamily(input: {
      category: CatalogFamilyId;
      familyKey: string;
      sku?: string | null;
    }): Promise<{
      family: PublicCatalogFamily;
      selected: PublicCatalogItem;
    } | null> {
      const family = groupCatalogFamilies(await allItems()).find(
        (candidate) =>
          candidate.category === input.category &&
          candidate.familyKey === input.familyKey,
      );
      if (!family) return null;
      const selected = input.sku
        ? family.variants.find((variant) => variant.sku === input.sku)
        : family.variants[0];
      return selected ? { family, selected } : null;
    },
    async findItem(sku: string) {
      return (await allItems()).find((item) => item.sku === sku) ?? null;
    },
    async wasHosePublishedInSupersededRelease(sku: string) {
      const row = await database
        .prepare(
          `SELECT 1 AS found
           FROM catalog_releases r
           INNER JOIN catalog_skus s ON s.import_id = r.source_import_id
           WHERE r.status = 'superseded'
             AND s.product_type = 'hose'
             AND s.catalog_publication_status = 'Published'
             AND s.sku = ?
           LIMIT 1`,
        )
        .bind(sku)
        .first<{ found: number }>();
      return row?.found === 1;
    },
  };
}
