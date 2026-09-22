-- Only the item-publication baseline can contribute unavailable hoses.
-- Materialize that import before joining runtime views with historical rows.
DROP VIEW catalog_item_unavailable_hoses;
CREATE VIEW catalog_item_unavailable_hoses AS
WITH baseline AS MATERIALIZED (
  SELECT r.source_import_id AS import_id
  FROM catalog_item_publication_state state
  JOIN catalog_releases r ON r.id = state.baseline_release_id
  WHERE state.mode = 'items'
), hoses AS MATERIALIZED (
  SELECT import_id, sku, hose_series FROM catalog_runtime_hose_variants
  WHERE import_id IN (SELECT import_id FROM baseline)
), skus AS MATERIALIZED (
  SELECT import_id, sku, catalog_publication_status, rfq_eligibility,
         supply_availability
  FROM catalog_runtime_skus
  WHERE import_id IN (SELECT import_id FROM baseline)
    AND product_type = 'hose'
)
SELECT h.sku FROM hoses h
JOIN skus sku ON sku.import_id = h.import_id AND sku.sku = h.sku
WHERE h.hose_series IN (SELECT hose_series FROM catalog_assembly_pending_series)
   OR sku.catalog_publication_status <> 'Published'
   OR sku.rfq_eligibility <> 'Eligible'
   OR sku.supply_availability <> 'available_for_quote';
--> statement-breakpoint
UPDATE application_schema_state SET version=80, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
