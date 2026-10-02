import { publicCatalogMainImageUrl } from "../domain/catalog-main-image";
import type { CatalogFamilyId } from "../domain/catalog-family";
import { normalizeDashSize } from "../domain/dash-size";
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

interface PublicCatalogRow {
  item_generation?: number | null;
  item_revision_id?: string | null;
  series_revision_id?: string | null;
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
  main_image_version_id: string | null;
  main_image_approved_reference: string | null;
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
    ...(row.item_generation == null
      ? {}
      : {
          catalogBasis: {
            generation: row.item_generation,
            skuRevisionId:
              row.item_revision_id ?? `legacy:${row.release_id}:sku:${row.sku}`,
            seriesRevisionId:
              row.series_revision_id ??
              (row.hose_series
                ? `legacy:${row.release_id}:series:${row.hose_series}`
                : null),
            mediaVersionId: row.main_image_version_id,
          },
        }),
    aliases: product.aliases.filter((value): value is string => Boolean(value)),
    canAddToQuote:
      row.rfq_eligibility === "Eligible" &&
      row.supply_availability === "available_for_quote",
    category: categoryByProductType[row.product_type],
    displayName: product.displayName,
    familyKey: product.familyKey,
    familyName: product.familyName,
    interfaceGroup: interfaceGroup(product.interface),
    mainImageUrl: publicCatalogMainImageUrl(
      row.main_image_version_id,
      row.main_image_approved_reference,
    ),
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

type Record_ = Record<string, unknown>;

// The storefront needs one row per published SKU joined to a dozen runtime views. A single SQL join of
// materialized CTEs makes SQLite rescan every CTE once per SKU (rows read grow with SKUs squared: ~1.7M rows
// for 645 SKUs, and D1 bills rows read). Each view is instead read once, filtered to the active import, and
// joined here by key. Every join key is unique per import, so the result equals the former join row for row.
const activeImport = `(
  SELECT r.source_import_id FROM catalog_active_release ar
  JOIN catalog_releases r ON r.id = ar.release_id
)`;

function column(source: Record_ | undefined, key: string) {
  return source?.[key] ?? null;
}

function mapped(source: Record_ | undefined, columns: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(columns).map(([output, key]) => [
      output,
      column(source, key),
    ]),
  );
}

function bySku(rows: Record_[], key = "sku") {
  return new Map(rows.map((row) => [String(row[key]), row]));
}

function byCode(rows: Record_[]) {
  return new Map(rows.map((row) => [`${row.product_type}:${row.code}`, row]));
}

export async function readPublicCatalogRows(
  database: D1Database,
  sku?: string,
): Promise<PublicCatalogRow[]> {
  const single = sku !== undefined;
  const view = (name: string, skuColumn: string | null = "sku") =>
    database
      .prepare(
        `SELECT * FROM catalog_runtime_${name}
         WHERE import_id = ${activeImport}${single && skuColumn ? ` AND ${skuColumn} = ?1` : ""}`,
      )
      .bind(...(single && skuColumn ? [sku] : []));
  const [
    release,
    skus,
    itemState,
    skuEntities,
    seriesEntities,
    offers,
    images,
    hoses,
    hoseSeries,
    hoseEnds,
    hoseEndSeries,
    ferrules,
    adapters,
    couplers,
    rules,
    prices,
    fees,
    media,
  ] = await database.batch<Record_>([
    database.prepare(
      `SELECT r.id AS release_id, r.release_number
       FROM catalog_active_release ar
       INNER JOIN catalog_releases r ON r.id = ar.release_id
       WHERE ar.singleton = 1 AND r.status = 'published'`,
    ),
    database
      .prepare(
        `/* public catalog scan */ SELECT * FROM catalog_runtime_skus
         WHERE import_id = ${activeImport}
           AND catalog_publication_status = 'Published'${single ? " AND sku = ?1" : ""}
         ORDER BY product_type, sku`,
      )
      .bind(...(single ? [sku] : [])),
    database.prepare(
      "SELECT mode, generation FROM catalog_item_publication_state WHERE singleton = 1",
    ),
    database
      .prepare(
        `SELECT product_type, code, current_revision_id FROM catalog_product_entities
         WHERE kind = 'sku'${single ? " AND code = ?1" : ""}`,
      )
      .bind(...(single ? [sku] : [])),
    database.prepare(
      `SELECT e.product_type, e.code, e.current_revision_id, r.media_version_id
       FROM catalog_product_entities e
       LEFT JOIN catalog_product_revisions r ON r.id = e.current_revision_id
       WHERE e.kind = 'series'`,
    ),
    view("sales_offers", "base_sku"),
    view("product_main_images"),
    view("hose_variants"),
    view("hose_series", null),
    view("hose_ends"),
    view("hose_end_series", null),
    view("ferrules"),
    view("adapters"),
    view("quick_couplers"),
    view("series_commercial_rules", null),
    view("sku_price_packaging"),
    database.prepare(
      "SELECT scope_key, rate_per_piece, version FROM cutting_labeling_fee_rates",
    ),
    database.prepare(
      "SELECT id, approved_reference FROM catalog_media_versions",
    ),
  ]);
  const activeRelease = release.results[0];
  if (!activeRelease) return [];
  const state = itemState.results[0];
  const offerBySku = bySku(offers.results, "base_sku");
  const imageBySku = bySku(
    images.results.filter((row) => row.assignment_kind === "override"),
  );
  const hoseBySku = bySku(hoses.results);
  const hoseSeriesByCode = bySku(hoseSeries.results, "series_code");
  const endBySku = bySku(hoseEnds.results);
  const endSeriesByCode = bySku(hoseEndSeries.results, "series_code");
  const ferruleBySku = bySku(ferrules.results);
  const adapterBySku = bySku(adapters.results);
  const couplerBySku = bySku(couplers.results);
  const priceBySku = bySku(prices.results);
  const ruleByKey = new Map(
    rules.results.map((row) => [`${row.product_type}:${row.series_code}`, row]),
  );
  const feeByScope = bySku(fees.results, "scope_key");
  const mediaById = bySku(media.results, "id");
  const skuEntityByKey = byCode(skuEntities.results);
  const seriesEntityByKey = byCode(seriesEntities.results);
  const globalFee = feeByScope.get("global");

  return skus.results.map((s) => {
    const key = String(s.sku);
    const type = String(s.product_type);
    const offer = offerBySku.get(key);
    const image = imageBySku.get(key);
    const exactPrice = priceBySku.get(key);
    const hose = hoseBySku.get(key);
    const series =
      hose?.hose_series != null
        ? hoseSeriesByCode.get(String(hose.hose_series))
        : undefined;
    const end = endBySku.get(key);
    const endSeries =
      end?.fitting_series != null
        ? endSeriesByCode.get(String(end.fitting_series))
        : undefined;
    const ferrule = ferruleBySku.get(key);
    const adapter = adapterBySku.get(key);
    const coupler = couplerBySku.get(key);
    const seriesCode =
      s.hose_series ??
      end?.fitting_series ??
      ferrule?.ferrule_series ??
      adapter?.adapter_family_id ??
      coupler?.coupler_series ??
      null;
    const seriesEntity =
      seriesCode != null
        ? seriesEntityByKey.get(`${type}:${seriesCode}`)
        : undefined;
    const ruleSeries = (
      {
        hose: hose?.hose_series,
        hose_end: end?.fitting_series,
        ferrule: ferrule?.ferrule_series,
        adapter: adapter?.adapter_family_id,
        quick_coupler: coupler?.coupler_series,
      } as Record_
    )[type];
    const rule =
      ruleSeries != null ? ruleByKey.get(`${type}:${ruleSeries}`) : undefined;
    const seriesFee =
      s.hose_series != null
        ? feeByScope.get(`series:${s.hose_series}`)
        : undefined;
    const mediaId =
      image?.media_version_id ??
      series?.representative_media_version_id ??
      endSeries?.representative_media_version_id ??
      seriesEntity?.media_version_id ??
      null;
    const selectedMedia =
      mediaId != null ? mediaById.get(String(mediaId)) : undefined;
    const exact = exactPrice?.id != null;
    const ruled = rule?.id != null;
    // Pricing and length rules come from the series rule when it exists, otherwise from the offer.
    const ruleOrOffer = (name: string) =>
      ruled ? column(rule, name) : column(offer, name);
    return {
      item_generation: state?.mode === "items" ? state.generation : null,
      item_revision_id: column(
        skuEntityByKey.get(`${type}:${key}`),
        "current_revision_id",
      ),
      series_revision_id: column(seriesEntity, "current_revision_id"),
      release_id: activeRelease.release_id,
      release_number: activeRelease.release_number,
      sku: s.sku,
      product_type: s.product_type,
      hose_series: s.hose_series,
      rfq_eligibility: s.rfq_eligibility,
      supply_availability: s.supply_availability,
      main_image_version_id: column(selectedMedia, "id"),
      main_image_approved_reference: column(
        selectedMedia,
        "approved_reference",
      ),
      sales_unit: column(rule, "sales_unit") ?? column(offer, "sales_unit"),
      moq: column(rule, "moq") ?? column(offer, "moq"),
      lead_time_days:
        column(rule, "lead_time_days") ?? column(offer, "lead_time_days"),
      currency: exact
        ? column(exactPrice, "currency")
        : column(offer, "currency"),
      reference_price_usd: exact
        ? column(exactPrice, "reference_price_usd")
        : column(offer, "reference_price_usd"),
      quantity_input_mode:
        column(rule, "quantity_input_mode") ??
        column(offer, "quantity_input_mode"),
      minimum_length_per_piece_ft: ruleOrOffer("minimum_length_per_piece_ft"),
      length_increment_ft: ruleOrOffer("length_increment_ft"),
      preset_length_1_ft: ruleOrOffer("preset_length_1_ft"),
      preset_length_2_ft: ruleOrOffer("preset_length_2_ft"),
      preset_length_3_ft: ruleOrOffer("preset_length_3_ft"),
      cutting_labeling_fee_rate:
        column(seriesFee, "rate_per_piece") ??
        column(globalFee, "rate_per_piece"),
      cutting_labeling_fee_scope:
        column(seriesFee, "scope_key") ?? column(globalFee, "scope_key"),
      cutting_labeling_fee_version:
        column(seriesFee, "version") ?? column(globalFee, "version"),
      ...mapped(series, {
        primary_standard: "primary_standard",
        equivalent_standard: "equivalent_standard",
        hose_temp_min_c: "temp_min_c",
        hose_temp_max_c: "temp_max_c",
        tube_material: "tube_material",
        reinforcement: "reinforcement",
        cover_material: "cover_material",
        cover_color: "cover_color",
        cover_finish: "cover_finish",
        fluid_compatibility: "fluid_compatibility",
      }),
      ...mapped(hose, {
        dash: "dash",
        nominal_id_in: "nominal_id_in",
        id_mm: "id_mm",
        od_mm: "od_mm",
        working_bar: "working_bar",
        working_psi: "working_psi",
        burst_bar: "burst_bar",
        bend_radius_mm: "bend_radius_mm",
        hose_weight_kg_m: "weight_kg_m",
      }),
      ...mapped(end, {
        fitting_series: "fitting_series",
        competitor_part_number: "competitor_part_number",
        thread: "thread",
        connection_dash: "connection_dash",
        hose_tail_dash: "hose_tail_dash",
        hose_end_material: "material",
        hose_end_coating: "coating",
        hose_end_max_working_bar: "max_working_bar",
        dimension_a_mm: "dimension_a_mm",
        cutoff_b_mm: "cutoff_b_mm",
        hex_1_mm: "hex_1_mm",
        hex_2_mm: "hex_2_mm",
        minimum_bore_mm: "minimum_bore_mm",
        hose_end_unit_weight_g: "unit_weight_g",
      }),
      ...mapped(endSeries, {
        interface_family: "interface_family",
        connection_standard: "connection_standard",
        gender: "gender",
        swivel_form: "swivel_form",
        angle: "angle",
        sealing_form: "sealing_form",
      }),
      ...mapped(ferrule, {
        ferrule_series: "ferrule_series",
        hose_construction: "hose_construction",
        ferrule_hose_tail_dash: "hose_tail_dash",
        skive_requirement: "skive_requirement",
        ferrule_material: "material",
        ferrule_coating: "coating",
      }),
      ...mapped(adapter, {
        adapter_family_id: "adapter_family_id",
        catalog_model: "catalog_model",
        website_product_name: "website_product_name",
        shape_code: "shape_code",
        interface_1: "interface_1",
        connection_form_1: "connection_form_1",
        size_1: "size_1",
        interface_2: "interface_2",
        connection_form_2: "connection_form_2",
        size_2: "size_2",
      }),
      ...mapped(coupler, {
        coupler_series: "coupler_series",
        role: "role",
        interchange_standard: "interchange_standard",
        body_size: "body_size",
        port_interface: "port_interface",
        port_gender: "port_gender",
        port_thread: "port_thread",
        connection_mechanism: "connection_mechanism",
        valving: "valving",
        body_material: "body_material",
        coupler_coating: "coating",
        seal_material: "seal_material",
        coupler_max_working_bar: "max_working_bar",
        minimum_burst_bar: "minimum_burst_bar",
        rated_flow_l_min: "rated_flow_l_min",
        coupler_temp_min_c: "temp_min_c",
        coupler_temp_max_c: "temp_max_c",
        overall_length_mm: "overall_length_mm",
        coupler_unit_weight_g: "unit_weight_g",
      }),
    } as unknown as PublicCatalogRow;
  });
}

function normalizeFerrule(
  row: PublicCatalogRow & { ferrule_hose_tail_dash?: string | null },
) {
  if (row.product_type === "ferrule") {
    row.hose_tail_dash = row.ferrule_hose_tail_dash ?? row.hose_tail_dash;
  }
  return row;
}

export function createD1PublicCatalogRepository(
  database: D1Database,
  options: { cacheItems?: boolean } = {},
) {
  const cachedItems = new Map<string, Promise<PublicCatalogItem | null>>();

  async function loadAllItems() {
    const rows = await readPublicCatalogRows(database);
    return rows.map(normalizeFerrule).map(publicCatalogItemFromRow);
  }

  async function loadItem(sku: string) {
    const [row] = await readPublicCatalogRows(database, sku);
    return row ? publicCatalogItemFromRow(normalizeFerrule(row)) : null;
  }

  function cachedFindItem(sku: string) {
    if (!options.cacheItems) return loadItem(sku);
    const existing = cachedItems.get(sku);
    if (existing) return existing;
    const pending = loadItem(sku).catch((error) => {
      cachedItems.delete(sku);
      throw error;
    });
    cachedItems.set(sku, pending);
    return pending;
  }

  return {
    async browse(input: {
      category?: CatalogFamilyId | null;
      query?: string | null;
    }) {
      const items = (await loadAllItems()).filter(
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
      const family = groupCatalogFamilies(await loadAllItems()).find(
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
      return cachedFindItem(sku);
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
