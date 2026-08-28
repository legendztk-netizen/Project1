import { interfaceGroup } from "../../catalog/domain/public-catalog";
import { normalizeDashSize } from "../../catalog/domain/dash-size";
import type { CompatibleHoseEndCandidate } from "../domain/compatible-end-a";

interface CompatibleHoseEndRow {
  angle: string;
  assembly_working_bar: number | string | null;
  compatibility_id: string;
  competitor_part_number: string | null;
  connection_dash: string;
  connection_standard: string;
  ferrule_hose_construction: string;
  ferrule_hose_tail_dash: string;
  ferrule_series: string;
  ferrule_skive_requirement: string;
  ferrule_sku: string;
  fitting_series: string;
  gender: string;
  hose_end_sku: string;
  hose_tail_dash: string;
  interface_family: string;
  max_working_bar: number | string | null;
  sealing_form: string;
  swivel_form: string;
  thread: string;
}

function hoseEndLengthClass(fittingSeries: string) {
  const code = fittingSeries.trim().split(/\s+/, 1)[0]?.toUpperCase();
  if (code === "FJX90L" || code === "FFX90L") {
    return "Long";
  }
  if (code === "FJX90M" || code === "FFX90M") {
    return "Medium";
  }
  return null;
}

function hoseEndInterface(row: CompatibleHoseEndRow) {
  const seriesCode = row.fitting_series
    .trim()
    .split(/\s+/, 1)[0]
    ?.toUpperCase();
  if (
    seriesCode === "FPX" ||
    row.connection_standard.toUpperCase().includes("NPSM")
  ) {
    return "NPSM";
  }
  if (seriesCode?.startsWith("C61")) return "SAE Code 61";
  return row.interface_family;
}

function nullableNumber(value: number | string | null) {
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compatibleHoseEndCandidateFromRow(
  row: CompatibleHoseEndRow,
): CompatibleHoseEndCandidate {
  const customerInterface = hoseEndInterface(row);
  const lengthClass = hoseEndLengthClass(row.fitting_series);
  const group = interfaceGroup(customerInterface) ?? customerInterface;
  return {
    aliases: [
      row.competitor_part_number,
      row.fitting_series,
      row.interface_family,
      row.connection_standard,
      row.thread,
      row.connection_dash,
      row.hose_tail_dash,
    ].filter((value): value is string => Boolean(value)),
    angle: row.angle,
    assemblyWorkingBar: nullableNumber(row.assembly_working_bar),
    compatibilityId: row.compatibility_id,
    connectionDash: normalizeDashSize(row.connection_dash),
    connectionStandard: row.connection_standard,
    displayName: [
      customerInterface,
      row.gender === "N/A" ? null : row.gender,
      row.swivel_form,
      row.angle,
      lengthClass,
      "Hose End",
    ]
      .filter(Boolean)
      .join(" "),
    ferrule: {
      hoseConstruction: row.ferrule_hose_construction,
      hoseTailDash: normalizeDashSize(row.ferrule_hose_tail_dash),
      series: row.ferrule_series,
      skiveRequirement: row.ferrule_skive_requirement,
      sku: row.ferrule_sku,
    },
    gender: row.gender,
    hoseEndSku: row.hose_end_sku,
    hoseTailDash: normalizeDashSize(row.hose_tail_dash),
    interfaceFamily: customerInterface,
    interfaceGroup: group,
    maximumWorkingBar: nullableNumber(row.max_working_bar),
    mediaKey: [
      customerInterface,
      row.gender === "N/A" ? null : row.gender,
      row.swivel_form,
      row.angle,
      lengthClass,
    ]
      .filter(Boolean)
      .join("-"),
    sealingForm: row.sealing_form,
    swivelForm: row.swivel_form,
    thread: row.thread,
  };
}

const compatibleHoseEndSql = `
  SELECT c.compatibility_id, c.hose_end_sku, c.ferrule_sku,
         c.assembly_working_bar,
         e.competitor_part_number, e.fitting_series, e.interface_family,
         e.connection_standard, e.gender, e.swivel_form, e.angle,
         e.sealing_form, e.thread, e.connection_dash, e.hose_tail_dash,
         e.max_working_bar,
         f.ferrule_series, f.hose_construction AS ferrule_hose_construction,
         f.hose_tail_dash AS ferrule_hose_tail_dash,
         f.skive_requirement AS ferrule_skive_requirement
  FROM catalog_releases r
  INNER JOIN catalog_compatibilities c
    ON c.import_id = r.source_import_id
  INNER JOIN catalog_skus hs
    ON hs.import_id = c.import_id AND hs.sku = c.hose_sku
  INNER JOIN catalog_hose_ends e
    ON e.import_id = c.import_id AND e.sku = c.hose_end_sku
  INNER JOIN catalog_skus es
    ON es.import_id = e.import_id AND es.sku = e.sku
  INNER JOIN catalog_ferrules f
    ON f.import_id = c.import_id AND f.sku = c.ferrule_sku
  INNER JOIN catalog_skus fs
    ON fs.import_id = f.import_id AND fs.sku = f.sku
  WHERE r.id = ?
    AND r.status IN ('published', 'superseded')
    AND c.hose_sku = ?
    AND c.catalog_publication_status = 'Published'
    AND c.rfq_eligibility = 'Eligible'
    AND hs.product_type = 'hose'
    AND hs.catalog_publication_status = 'Published'
    AND hs.rfq_eligibility = 'Eligible'
    AND hs.supply_availability = 'available_for_quote'
    AND es.product_type = 'hose_end'
    AND es.catalog_publication_status = 'Published'
    AND es.rfq_eligibility = 'Eligible'
    AND es.supply_availability = 'available_for_quote'
    AND fs.product_type = 'ferrule'
    AND fs.catalog_publication_status = 'Published'
    AND fs.rfq_eligibility = 'Eligible'
    AND fs.supply_availability = 'available_for_quote'
  ORDER BY e.interface_family, e.angle, e.gender, e.swivel_form,
           e.connection_dash, e.hose_tail_dash, e.sku`;

export function createD1ConfiguratorRepository(database: D1Database) {
  return {
    async findCompatibleEndA(releaseId: string, hoseSku: string) {
      const rows = await database
        .prepare(compatibleHoseEndSql)
        .bind(releaseId, hoseSku)
        .all<CompatibleHoseEndRow>();
      return rows.results.map(compatibleHoseEndCandidateFromRow);
    },
  };
}
