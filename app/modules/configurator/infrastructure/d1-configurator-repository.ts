import { interfaceGroup } from "../../catalog/domain/public-catalog";
import { normalizeDashSize } from "../../catalog/domain/dash-size";
import type { CompatibleEndACandidate } from "../domain/compatible-end-a";

interface CompatibleEndARow {
  angle: string;
  compatibility_id: string;
  competitor_part_number: string | null;
  connection_dash: string;
  connection_standard: string;
  ferrule_hose_construction: string;
  ferrule_hose_tail_dash: string;
  ferrule_series: string;
  ferrule_skive_requirement: string;
  ferrule_sku: string;
  gender: string;
  hose_end_sku: string;
  hose_tail_dash: string;
  interface_family: string;
  sealing_form: string;
  swivel_form: string;
  thread: string;
}

export function compatibleEndACandidateFromRow(
  row: CompatibleEndARow,
): CompatibleEndACandidate {
  const group = interfaceGroup(row.interface_family) ?? row.interface_family;
  return {
    aliases: [
      row.competitor_part_number,
      row.connection_standard,
      row.thread,
      row.connection_dash,
      row.hose_tail_dash,
    ].filter((value): value is string => Boolean(value)),
    angle: row.angle,
    compatibilityId: row.compatibility_id,
    connectionDash: normalizeDashSize(row.connection_dash),
    connectionStandard: row.connection_standard,
    displayName: [
      row.interface_family,
      row.gender,
      row.swivel_form,
      row.angle,
      "Hose End",
    ].join(" "),
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
    interfaceFamily: row.interface_family,
    interfaceGroup: group,
    sealingForm: row.sealing_form,
    swivelForm: row.swivel_form,
    thread: row.thread,
  };
}

const compatibleEndASql = `
  SELECT c.compatibility_id, c.hose_end_sku, c.ferrule_sku,
         e.competitor_part_number, e.interface_family,
         e.connection_standard, e.gender, e.swivel_form, e.angle,
         e.sealing_form, e.thread, e.connection_dash, e.hose_tail_dash,
         f.ferrule_series, f.hose_construction AS ferrule_hose_construction,
         f.hose_tail_dash AS ferrule_hose_tail_dash,
         f.skive_requirement AS ferrule_skive_requirement
  FROM catalog_active_release ar
  INNER JOIN catalog_releases r
    ON r.id = ar.release_id AND r.status = 'published'
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
  WHERE ar.singleton = 1
    AND c.hose_sku = ?
    AND c.catalog_publication_status <> 'Archived'
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
    async findCompatibleEndA(hoseSku: string) {
      const rows = await database
        .prepare(compatibleEndASql)
        .bind(hoseSku)
        .all<CompatibleEndARow>();
      return rows.results.map(compatibleEndACandidateFromRow);
    },
  };
}
