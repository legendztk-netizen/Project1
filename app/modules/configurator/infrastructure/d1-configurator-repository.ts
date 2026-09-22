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

function compatibleHoseEndSql(selectedOnly = false) {
  const compatibilities = selectedOnly
    ? "scoped_compatibilities"
    : "catalog_runtime_compatibilities";
  const skus = selectedOnly ? "scoped_skus" : "catalog_runtime_skus";
  const ends = selectedOnly ? "scoped_ends" : "catalog_runtime_hose_ends";
  const series = selectedOnly
    ? "scoped_series"
    : "catalog_runtime_hose_end_series";
  const ferrules = selectedOnly
    ? "scoped_ferrules"
    : "catalog_runtime_ferrules";
  return `
  WITH scoped_compatibilities AS MATERIALIZED (
    SELECT * FROM catalog_runtime_compatibilities
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND hose_sku = ?2
      ${selectedOnly ? "AND hose_end_sku IN (?3, ?4)" : ""}
  ), scoped_skus AS MATERIALIZED (
    SELECT * FROM catalog_runtime_skus
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND sku IN (SELECT hose_sku FROM scoped_compatibilities
        UNION SELECT hose_end_sku FROM scoped_compatibilities
        UNION SELECT ferrule_sku FROM scoped_compatibilities)
  ), scoped_ends AS MATERIALIZED (
    SELECT * FROM catalog_runtime_hose_ends
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND sku IN (SELECT hose_end_sku FROM scoped_compatibilities)
  ), scoped_series AS MATERIALIZED (
    SELECT * FROM catalog_runtime_hose_end_series
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND series_code IN (SELECT fitting_series FROM scoped_ends)
  ), scoped_ferrules AS MATERIALIZED (
    SELECT * FROM catalog_runtime_ferrules
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND sku IN (SELECT ferrule_sku FROM scoped_compatibilities)
  ), eligible_endpoint AS (
    ${
      selectedOnly
        ? `
    SELECT ?1 AS release_id, hose_sku, compatibility_id
    FROM scoped_compatibilities
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND hose_sku = ?2 AND hose_end_sku IN (?3, ?4)
    `
        : `
    SELECT DISTINCT release_id,hose_sku,end_a_compatibility_id AS compatibility_id FROM catalog_available_assembly_combinations
    WHERE release_id = ?1 AND hose_sku = ?2
    UNION SELECT DISTINCT release_id,hose_sku,end_b_compatibility_id FROM catalog_available_assembly_combinations
    WHERE release_id = ?1 AND hose_sku = ?2
    `
    }
  )
  SELECT c.compatibility_id, c.hose_end_sku, c.ferrule_sku,
         c.assembly_working_bar,
         e.competitor_part_number, e.fitting_series, series.interface_family,
         series.connection_standard, series.gender, series.swivel_form,
         series.angle, series.sealing_form, e.thread,
         e.connection_dash, e.hose_tail_dash,
         e.max_working_bar,
         f.ferrule_series, f.hose_construction AS ferrule_hose_construction,
         f.hose_tail_dash AS ferrule_hose_tail_dash,
         f.skive_requirement AS ferrule_skive_requirement
  FROM catalog_releases r
  INNER JOIN eligible_endpoint derived
    ON derived.release_id = r.id
  INNER JOIN ${compatibilities} c
    ON c.import_id = r.source_import_id
   AND c.hose_sku = derived.hose_sku
   AND c.compatibility_id = derived.compatibility_id
  INNER JOIN ${skus} hs
    ON hs.import_id = c.import_id AND hs.sku = c.hose_sku
  INNER JOIN ${ends} e
    ON e.import_id = c.import_id AND e.sku = c.hose_end_sku
  INNER JOIN ${series} series
    ON series.import_id = e.import_id AND series.series_code = e.fitting_series
  INNER JOIN ${skus} es
    ON es.import_id = e.import_id AND es.sku = e.sku
  INNER JOIN ${ferrules} f
    ON f.import_id = c.import_id AND f.sku = c.ferrule_sku
  INNER JOIN ${skus} fs
    ON fs.import_id = f.import_id AND fs.sku = f.sku
  WHERE r.id = ?1
    AND r.status IN ('published', 'superseded')
    AND c.hose_sku = ?2
    AND NOT EXISTS (SELECT 1 FROM catalog_item_unavailable_hoses blocked WHERE blocked.sku = c.hose_sku)
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
  ORDER BY series.interface_family, series.angle, series.gender, series.swivel_form,
           e.connection_dash, e.hose_tail_dash, e.sku`;
}

export function createD1ConfiguratorRepository(database: D1Database) {
  return {
    async findCompatibleEndA(releaseId: string, hoseSku: string) {
      const rows = await database
        .prepare(compatibleHoseEndSql())
        .bind(releaseId, hoseSku)
        .all<CompatibleHoseEndRow>();
      return rows.results.map(compatibleHoseEndCandidateFromRow);
    },

    async findSelectedEnds(
      releaseId: string,
      hoseSku: string,
      endA: string,
      endB: string,
    ) {
      const rows = await database
        .prepare(compatibleHoseEndSql(true))
        .bind(releaseId, hoseSku, endA, endB)
        .all<CompatibleHoseEndRow>();
      return rows.results.map(compatibleHoseEndCandidateFromRow);
    },

    async hasDerivedAssemblyCombination(input: {
      endACompatibilityId: string;
      endBCompatibilityId: string;
      hoseSku: string;
      releaseId: string;
      identity?: string;
    }) {
      // Apply the availability view's guards to one ordered pair. Filtering
      // before the runtime joins avoids materializing historical catalogs.
      if (input.identity) {
        const row = await database
          .prepare(
            `
          WITH release AS MATERIALIZED (
            SELECT * FROM catalog_releases WHERE id = ?1
              AND status IN ('published', 'superseded')
          ), combinations AS MATERIALIZED (
            SELECT * FROM catalog_runtime_assembly_combinations
            WHERE release_id = ?1 AND hose_sku = ?2
              AND end_a_compatibility_id = ?3 AND end_b_compatibility_id = ?4
              AND identity = ?5
          ), endpoints AS MATERIALIZED (
            SELECT * FROM catalog_runtime_compatibilities
            WHERE import_id IN (SELECT source_import_id FROM release)
              AND hose_sku = ?2 AND compatibility_id IN (?3, ?4)
          ), skus AS MATERIALIZED (
            SELECT * FROM catalog_runtime_skus
            WHERE import_id IN (SELECT source_import_id FROM release)
              AND sku IN (SELECT value FROM json_each(?5))
          )
          SELECT 1 AS found FROM combinations c
          JOIN release r ON r.id = c.release_id
          JOIN endpoints a ON a.import_id = r.source_import_id AND a.hose_sku = c.hose_sku
            AND a.compatibility_id = c.end_a_compatibility_id
            AND a.hose_end_sku = c.end_a_hose_end_sku AND a.ferrule_sku = c.end_a_ferrule_sku
          JOIN endpoints b ON b.import_id = r.source_import_id AND b.hose_sku = c.hose_sku
            AND b.compatibility_id = c.end_b_compatibility_id
            AND b.hose_end_sku = c.end_b_hose_end_sku AND b.ferrule_sku = c.end_b_ferrule_sku
          WHERE a.catalog_publication_status = 'Published' AND a.rfq_eligibility = 'Eligible'
            AND b.catalog_publication_status = 'Published' AND b.rfq_eligibility = 'Eligible'
            AND NOT EXISTS (SELECT 1 FROM catalog_item_unavailable_hoses h WHERE h.sku = c.hose_sku)
            AND (SELECT COUNT(*) FROM skus p WHERE p.import_id = r.source_import_id
              AND p.catalog_publication_status = 'Published' AND p.rfq_eligibility = 'Eligible'
              AND p.supply_availability = 'available_for_quote')
              = (SELECT COUNT(DISTINCT value) FROM json_each(c.identity))
            AND NOT EXISTS (
              SELECT 1 FROM catalog_assembly_exclusions x
              JOIN catalog_item_publication_state state ON state.mode = 'items' AND state.baseline_release_id = c.release_id
              WHERE x.identity = c.identity AND x.disabled = 1
            )
          LIMIT 1
        `,
          )
          .bind(
            input.releaseId,
            input.hoseSku,
            input.endACompatibilityId,
            input.endBCompatibilityId,
            input.identity,
          )
          .first<{ found: number }>();
        return Boolean(row);
      }
      const row = await database
        .prepare(
          `SELECT 1 AS found FROM catalog_available_assembly_combinations
           WHERE release_id=? AND hose_sku=? AND end_a_compatibility_id=? AND end_b_compatibility_id=?`,
        )
        .bind(
          input.releaseId,
          input.hoseSku,
          input.endACompatibilityId,
          input.endBCompatibilityId,
        )
        .first<{ found: number }>();
      return Boolean(row);
    },
  };
}
