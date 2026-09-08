-- Expand beside immutable legacy releases. Activation is explicit per database.
CREATE TABLE catalog_item_publication_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  mode TEXT NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy', 'items')),
  baseline_release_id TEXT REFERENCES catalog_releases(id),
  generation INTEGER NOT NULL DEFAULT 0
);
INSERT INTO catalog_item_publication_state(singleton) VALUES (1);
--> statement-breakpoint
CREATE TABLE catalog_product_entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('series', 'sku')),
  product_type TEXT NOT NULL CHECK (product_type IN ('hose', 'hose_end', 'ferrule', 'adapter', 'quick_coupler')),
  code TEXT NOT NULL,
  current_revision_id TEXT REFERENCES catalog_product_revisions(id),
  draft_revision_id TEXT REFERENCES catalog_product_revisions(id),
  UNIQUE(kind, product_type, code)
);
CREATE UNIQUE INDEX catalog_product_sku_identity ON catalog_product_entities(code) WHERE kind = 'sku';
--> statement-breakpoint
CREATE TABLE catalog_product_change_requests (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  original_json TEXT NOT NULL CHECK(json_valid(original_json)),
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json)),
  baseline_revision_id TEXT,
  target_state TEXT NOT NULL CHECK(target_state IN ('online', 'draft', 'discontinued')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'deleted')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_revision_id TEXT REFERENCES catalog_product_revisions(id)
);
--> statement-breakpoint
CREATE TABLE catalog_product_revisions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  entity_id TEXT NOT NULL REFERENCES catalog_product_entities(id),
  target_state TEXT NOT NULL CHECK(target_state IN ('online', 'draft', 'discontinued')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  media_version_id TEXT REFERENCES catalog_media_versions(id),
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  affected_series_json TEXT NOT NULL CHECK(json_valid(affected_series_json)),
  baseline_revision_id TEXT,
  previous_revision_id TEXT,
  request_id TEXT UNIQUE REFERENCES catalog_product_change_requests(id),
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  expected_generation INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX catalog_product_revision_history ON catalog_product_revisions(entity_id, sequence);
--> statement-breakpoint
CREATE TABLE catalog_item_assembly_state (
  hose_series TEXT PRIMARY KEY,
  invalidated_sequence INTEGER NOT NULL,
  generated_sequence INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TRIGGER catalog_item_revision_precondition BEFORE INSERT ON catalog_product_revisions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM catalog_item_publication_state
    WHERE singleton = 1 AND mode = 'items' AND generation = NEW.expected_generation
  ) THEN RAISE(ABORT, 'catalog item generation changed') END;
  SELECT CASE WHEN NEW.request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM catalog_product_change_requests WHERE id = NEW.request_id AND status = 'pending'
  ) THEN RAISE(ABORT, 'catalog request is not pending') END;
  SELECT CASE WHEN NEW.request_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM catalog_product_change_requests request, json_each(request.dependencies_json) dependency
    LEFT JOIN catalog_product_change_requests parent ON parent.id = dependency.value
    WHERE request.id = NEW.request_id AND COALESCE(parent.status, '') <> 'approved'
  ) THEN RAISE(ABORT, 'catalog request dependency is not approved') END;
END;
--> statement-breakpoint
CREATE TRIGGER catalog_item_revision_apply AFTER INSERT ON catalog_product_revisions
BEGIN
  UPDATE catalog_product_entities SET
    current_revision_id = CASE WHEN NEW.target_state <> 'draft' THEN NEW.id ELSE current_revision_id END,
    draft_revision_id = CASE WHEN NEW.target_state = 'draft' THEN NEW.id ELSE draft_revision_id END
  WHERE id = NEW.entity_id;
  UPDATE catalog_item_publication_state SET generation = NEW.sequence WHERE singleton = 1;
  INSERT INTO catalog_item_assembly_state(hose_series, invalidated_sequence)
    SELECT value, NEW.sequence FROM json_each(NEW.affected_series_json) WHERE NEW.target_state <> 'draft'
    ON CONFLICT(hose_series) DO UPDATE SET invalidated_sequence = excluded.invalidated_sequence;
  UPDATE catalog_product_change_requests SET status = 'approved', applied_revision_id = NEW.id
    WHERE id = NEW.request_id;
  INSERT INTO admin_audit_events(id, event_type, entity_type, entity_id, actor_id, payload_json, occurred_at)
    VALUES ('catalog-item:' || NEW.id, 'catalog_item.applied', 'product_revision', NEW.id, NEW.actor_id,
      json_object('source', json(NEW.source_json), 'targetState', NEW.target_state,
        'entityId', NEW.entity_id, 'baselineRevisionId', NEW.baseline_revision_id,
        'previousRevisionId', NEW.previous_revision_id, 'sequence', NEW.sequence,
        'affectedSeries', json(NEW.affected_series_json), 'requestId', NEW.request_id,
        'commandId', NEW.command_id, 'ipAddress', NEW.ip_address), NEW.occurred_at);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_product_revision_immutable_update BEFORE UPDATE ON catalog_product_revisions
BEGIN SELECT RAISE(ABORT, 'product revisions are immutable'); END;
CREATE TRIGGER catalog_product_revision_immutable_delete BEFORE DELETE ON catalog_product_revisions
BEGIN SELECT RAISE(ABORT, 'product revisions are immutable'); END;
CREATE TRIGGER catalog_product_entity_identity BEFORE UPDATE ON catalog_product_entities
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.product_type IS NOT OLD.product_type OR NEW.code IS NOT OLD.code
BEGIN SELECT RAISE(ABORT, 'product identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER catalog_item_freeze_legacy_pointer BEFORE UPDATE ON catalog_active_release
WHEN (SELECT mode FROM catalog_item_publication_state WHERE singleton = 1) = 'items'
BEGIN SELECT RAISE(ABORT, 'legacy catalog publication is disabled'); END;
CREATE TRIGGER catalog_item_freeze_legacy_publication BEFORE INSERT ON catalog_release_publications
WHEN (SELECT mode FROM catalog_item_publication_state WHERE singleton = 1) = 'items'
BEGIN SELECT RAISE(ABORT, 'legacy catalog publication is disabled'); END;
CREATE TRIGGER catalog_item_freeze_legacy_release BEFORE UPDATE ON catalog_releases
WHEN (SELECT mode FROM catalog_item_publication_state WHERE singleton = 1) = 'items' AND NEW.status <> OLD.status
BEGIN SELECT RAISE(ABORT, 'legacy catalog publication is disabled'); END;
CREATE TRIGGER catalog_item_mode_immutable BEFORE UPDATE ON catalog_item_publication_state
WHEN OLD.mode = 'items' AND (NEW.mode <> OLD.mode OR NEW.baseline_release_id IS NOT OLD.baseline_release_id)
BEGIN SELECT RAISE(ABORT, 'item publication requires forward recovery'); END;
--> statement-breakpoint
CREATE VIEW catalog_item_current AS
SELECT e.id AS entity_id, e.kind, e.product_type, e.code, r.id AS revision_id,
       r.target_state, r.payload_json, r.media_version_id, r.sequence, r.actor_id, r.occurred_at,
       b.source_import_id AS import_id
FROM catalog_product_entities e
JOIN catalog_product_revisions r ON r.id = e.current_revision_id
JOIN catalog_item_publication_state s ON s.singleton = 1 AND s.mode = 'items'
JOIN catalog_releases b ON b.id = s.baseline_release_id;
--> statement-breakpoint
CREATE VIEW catalog_runtime_skus AS
SELECT old.* FROM catalog_skus old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.product_type = 'hose' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       '01_胶管主数据' AS source_worksheet,
       n.product_type AS product_type,
       json_extract(n.payload_json, '$.variant.hoseSeries') AS hose_series,
       CASE n.target_state WHEN 'online' THEN 'Published' WHEN 'draft' THEN 'Draft' ELSE 'Archived' END AS catalog_publication_status,
       CASE n.target_state WHEN 'online' THEN 'Eligible' ELSE 'Blocked' END AS rfq_eligibility,
       COALESCE(json_extract(n.payload_json, '$.variant.technicalDataStatus'), 'Complete') AS technical_data_status,
       CASE n.target_state WHEN 'online' THEN 'available_for_quote' WHEN 'draft' THEN 'temporarily_unavailable' ELSE 'discontinued' END AS supply_availability
FROM catalog_item_current n

WHERE n.kind = 'sku' AND n.product_type = 'hose';
--> statement-breakpoint

CREATE VIEW catalog_runtime_hose_series AS
SELECT old.* FROM catalog_hose_series old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'series' AND n.product_type = 'hose' AND n.import_id = old.import_id AND n.code = old.series_code)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS series_code,
       json_extract(n.payload_json, '$.series.seriesName') AS series_name,
       json_extract(n.payload_json, '$.series.primaryStandard') AS primary_standard,
       json_extract(n.payload_json, '$.series.equivalentStandard') AS equivalent_standard,
       json_extract(n.payload_json, '$.series.tempMinC') AS temp_min_c,
       json_extract(n.payload_json, '$.series.tempMaxC') AS temp_max_c,
       json_extract(n.payload_json, '$.series.tubeMaterial') AS tube_material,
       json_extract(n.payload_json, '$.series.reinforcement') AS reinforcement,
       json_extract(n.payload_json, '$.series.coverMaterial') AS cover_material,
       json_extract(n.payload_json, '$.series.coverColor') AS cover_color,
       json_extract(n.payload_json, '$.series.coverFinish') AS cover_finish,
       json_extract(n.payload_json, '$.series.fluidCompatibility') AS fluid_compatibility,
       n.media_version_id AS representative_media_version_id
FROM catalog_item_current n

WHERE n.kind = 'series' AND n.product_type = 'hose';
--> statement-breakpoint

CREATE VIEW catalog_runtime_hose_variants AS
SELECT old.* FROM catalog_hose_variants old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.product_type = 'hose' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.hoseSeries') AS hose_series,
       hs.primary_standard AS primary_standard,
       hs.equivalent_standard AS equivalent_standard,
       json_extract(n.payload_json, '$.variant.dash') AS dash,
       json_extract(n.payload_json, '$.variant.nominalIdIn') AS nominal_id_in,
       json_extract(n.payload_json, '$.variant.idMm') AS id_mm,
       json_extract(n.payload_json, '$.variant.odMm') AS od_mm,
       json_extract(n.payload_json, '$.variant.workingBar') AS working_bar,
       json_extract(n.payload_json, '$.variant.workingPsi') AS working_psi,
       json_extract(n.payload_json, '$.variant.burstBar') AS burst_bar,
       json_extract(n.payload_json, '$.variant.bendRadiusMm') AS bend_radius_mm,
       json_extract(n.payload_json, '$.variant.weightKgM') AS weight_kg_m,
       hs.temp_min_c AS temp_min_c,
       hs.temp_max_c AS temp_max_c,
       hs.tube_material AS tube_material,
       hs.reinforcement AS reinforcement,
       hs.cover_material AS cover_material,
       hs.cover_color AS cover_color,
       hs.cover_finish AS cover_finish,
       json_extract(n.payload_json, '$.variant.skiveRequirement') AS skive_requirement,
       json_extract(n.payload_json, '$.variant.mshaMarking') AS msha_marking,
       hs.fluid_compatibility AS fluid_compatibility,
       NULL AS origin,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_current n
LEFT JOIN catalog_runtime_hose_series hs ON hs.import_id = n.import_id AND hs.series_code = json_extract(n.payload_json, '$.variant.hoseSeries')
WHERE n.kind = 'sku' AND n.product_type = 'hose';
--> statement-breakpoint

CREATE VIEW catalog_runtime_sales_offers AS
SELECT old.* FROM catalog_sales_offers old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.product_type = 'hose' AND n.import_id = old.import_id AND n.code = old.base_sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS base_sku,
       n.code AS sales_sku,
       'Hose Variant' AS product_type,
       cr.sales_unit AS sales_unit,
       json_extract(n.payload_json, '$.price.packageLengthFt') AS package_length_ft,
       json_extract(n.payload_json, '$.price.unitsPerSalesPack') AS units_per_sales_pack,
       cr.moq AS moq,
       json_extract(n.payload_json, '$.price.netUnitWeightKg') AS net_unit_weight_kg,
       cr.lead_time_days AS lead_time_days,
       cr.country_of_origin AS country_of_origin,
       json_extract(n.payload_json, '$.price.currency') AS currency,
       json_extract(n.payload_json, '$.price.amount') AS reference_price_usd,
       json_extract(n.payload_json, '$.price.innerPackQty') AS inner_pack_qty,
       json_extract(n.payload_json, '$.price.masterCartonQty') AS master_carton_qty,
       json_extract(n.payload_json, '$.price.cartonGrossWeightKg') AS carton_gross_weight_kg,
       json_extract(n.payload_json, '$.price.cartonLCm') AS carton_l_cm,
       json_extract(n.payload_json, '$.price.cartonWCm') AS carton_w_cm,
       json_extract(n.payload_json, '$.price.cartonHCm') AS carton_h_cm,
       json_extract(n.payload_json, '$.price.packingBasis') AS packing_basis,
       cr.hs_code AS hs_code,
       cr.notes AS notes,
       CASE n.target_state WHEN 'online' THEN 'Published' WHEN 'draft' THEN 'Draft' ELSE 'Archived' END AS catalog_publication_status,
       CASE n.target_state WHEN 'online' THEN 'Eligible' ELSE 'Blocked' END AS rfq_eligibility,
       COALESCE(json_extract(n.payload_json, '$.variant.technicalDataStatus'), 'Complete') AS technical_data_status,
       cr.quantity_input_mode AS quantity_input_mode,
       cr.minimum_length_per_piece_ft AS minimum_length_per_piece_ft,
       cr.length_increment_ft AS length_increment_ft,
       cr.preset_length_1_ft AS preset_length_1_ft,
       cr.preset_length_2_ft AS preset_length_2_ft,
       cr.preset_length_3_ft AS preset_length_3_ft,
       cr.continuous_length_confirmation AS continuous_length_confirmation
FROM catalog_item_current n
LEFT JOIN catalog_runtime_series_commercial_rules cr ON cr.import_id = n.import_id AND cr.product_type = 'hose' AND cr.series_code = json_extract(n.payload_json, '$.variant.hoseSeries')
WHERE n.kind = 'sku' AND n.product_type = 'hose';
--> statement-breakpoint

CREATE VIEW catalog_runtime_series_commercial_rules AS
SELECT old.* FROM catalog_series_commercial_rules old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'series' AND n.product_type = 'hose' AND n.import_id = old.import_id AND n.code = old.series_code AND n.product_type = old.product_type)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.product_type AS product_type,
       n.code AS series_code,
       json_extract(n.payload_json, '$.commercialRule.salesUnit') AS sales_unit,
       json_extract(n.payload_json, '$.commercialRule.moq') AS moq,
       json_extract(n.payload_json, '$.commercialRule.leadTimeDays') AS lead_time_days,
       json_extract(n.payload_json, '$.commercialRule.countryOfOrigin') AS country_of_origin,
       json_extract(n.payload_json, '$.commercialRule.hsCode') AS hs_code,
       json_extract(n.payload_json, '$.commercialRule.notes') AS notes,
       json_extract(n.payload_json, '$.commercialRule.quantityInputMode') AS quantity_input_mode,
       json_extract(n.payload_json, '$.commercialRule.minimumLengthPerPieceFt') AS minimum_length_per_piece_ft,
       json_extract(n.payload_json, '$.commercialRule.lengthIncrementFt') AS length_increment_ft,
       json_extract(n.payload_json, '$.commercialRule.presetLength1Ft') AS preset_length_1_ft,
       json_extract(n.payload_json, '$.commercialRule.presetLength2Ft') AS preset_length_2_ft,
       json_extract(n.payload_json, '$.commercialRule.presetLength3Ft') AS preset_length_3_ft,
       json_extract(n.payload_json, '$.commercialRule.continuousLengthConfirmation') AS continuous_length_confirmation
FROM catalog_item_current n

WHERE n.kind = 'series' AND n.product_type = 'hose';
--> statement-breakpoint

CREATE VIEW catalog_runtime_sku_price_packaging AS
SELECT old.* FROM catalog_sku_price_packaging old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.product_type = 'hose' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       n.code AS sales_sku,
       json_extract(n.payload_json, '$.price.amount') AS reference_price_usd,
       json_extract(n.payload_json, '$.price.currency') AS currency,
       json_extract(n.payload_json, '$.price.packageLengthFt') AS package_length_ft,
       json_extract(n.payload_json, '$.price.unitsPerSalesPack') AS units_per_sales_pack,
       json_extract(n.payload_json, '$.price.netUnitWeightKg') AS net_unit_weight_kg,
       json_extract(n.payload_json, '$.price.innerPackQty') AS inner_pack_qty,
       json_extract(n.payload_json, '$.price.masterCartonQty') AS master_carton_qty,
       json_extract(n.payload_json, '$.price.cartonGrossWeightKg') AS carton_gross_weight_kg,
       json_extract(n.payload_json, '$.price.cartonLCm') AS carton_l_cm,
       json_extract(n.payload_json, '$.price.cartonWCm') AS carton_w_cm,
       json_extract(n.payload_json, '$.price.cartonHCm') AS carton_h_cm,
       json_extract(n.payload_json, '$.price.packingBasis') AS packing_basis
FROM catalog_item_current n

WHERE n.kind = 'sku' AND n.product_type = 'hose';
--> statement-breakpoint

CREATE VIEW catalog_runtime_product_main_images AS
SELECT old.* FROM catalog_product_main_images old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.product_type = 'hose' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       n.media_version_id AS media_version_id,
       n.occurred_at AS assigned_at,
       n.actor_id AS assigned_by,
       'override' AS assignment_kind
FROM catalog_item_current n

WHERE n.kind = 'sku' AND n.product_type = 'hose';
--> statement-breakpoint

CREATE VIEW catalog_item_unavailable_hoses AS
SELECT h.sku FROM catalog_runtime_hose_variants h
JOIN catalog_item_publication_state state ON state.mode = 'items'
JOIN catalog_releases baseline ON baseline.id = state.baseline_release_id AND baseline.source_import_id = h.import_id
LEFT JOIN catalog_item_assembly_state dirty ON dirty.hose_series = h.hose_series
JOIN catalog_runtime_skus sku ON sku.import_id = h.import_id AND sku.sku = h.sku
WHERE dirty.invalidated_sequence > dirty.generated_sequence
   OR sku.catalog_publication_status <> 'Published'
   OR sku.supply_availability <> 'available_for_quote';
--> statement-breakpoint
UPDATE application_schema_state SET version = 54, updated_at = CURRENT_TIMESTAMP WHERE singleton = 1;
