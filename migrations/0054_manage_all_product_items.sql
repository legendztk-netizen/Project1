-- Expand the isolated publication contract to all five product types.
ALTER TABLE admin_identities ADD COLUMN catalog_permission TEXT NOT NULL DEFAULT 'edit' CHECK(catalog_permission IN ('view','edit'));
ALTER TABLE catalog_product_entities ADD COLUMN hidden_at TEXT;
CREATE TABLE catalog_product_deletions(id TEXT PRIMARY KEY, command_hash TEXT NOT NULL, expected_generation INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), actor_id TEXT NOT NULL, occurred_at TEXT NOT NULL);
--> statement-breakpoint
DROP VIEW catalog_runtime_skus;
DROP VIEW catalog_runtime_hose_series;
DROP VIEW catalog_runtime_hose_variants;
DROP VIEW catalog_runtime_sales_offers;
DROP VIEW catalog_runtime_series_commercial_rules;
DROP VIEW catalog_runtime_sku_price_packaging;
DROP VIEW catalog_runtime_product_main_images;
CREATE VIEW catalog_runtime_skus AS
SELECT old.* FROM catalog_skus old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       'manual-item' AS source_worksheet,
       n.product_type AS product_type,
       CASE n.product_type WHEN 'hose' THEN json_extract(n.payload_json, '$.variant.hoseSeries') WHEN 'hose_end' THEN json_extract(n.payload_json, '$.variant.fittingSeries') WHEN 'ferrule' THEN json_extract(n.payload_json, '$.variant.ferruleSeries') WHEN 'adapter' THEN json_extract(n.payload_json, '$.variant.adapterFamilyId') WHEN 'quick_coupler' THEN json_extract(n.payload_json, '$.variant.couplerSeries') END AS hose_series,
       CASE n.target_state WHEN 'online' THEN 'Published' WHEN 'draft' THEN 'Draft' ELSE 'Archived' END AS catalog_publication_status,
       CASE n.target_state WHEN 'online' THEN 'Eligible' ELSE 'Blocked' END AS rfq_eligibility,
       COALESCE(json_extract(n.payload_json,'$.variant.technicalDataStatus'),'Complete') AS technical_data_status,
       CASE n.target_state WHEN 'online' THEN 'available_for_quote' WHEN 'draft' THEN 'temporarily_unavailable' ELSE 'discontinued' END AS supply_availability
FROM catalog_item_current n

WHERE n.kind = 'sku';
--> statement-breakpoint
CREATE VIEW catalog_runtime_hose_series AS
SELECT old.* FROM catalog_hose_series old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'series' AND n.product_type = 'hose' AND n.import_id=old.import_id AND n.code=old.series_code)
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
CREATE VIEW catalog_runtime_hose_end_series AS
SELECT old.* FROM catalog_hose_end_series old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'series' AND n.product_type = 'hose_end' AND n.import_id=old.import_id AND n.code=old.series_code)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS series_code,
       json_extract(n.payload_json, '$.series.seriesName') AS series_name,
       json_extract(n.payload_json, '$.series.interfaceFamily') AS interface_family,
       json_extract(n.payload_json, '$.series.interfaceStandard') AS connection_standard,
       json_extract(n.payload_json, '$.series.gender') AS gender,
       json_extract(n.payload_json, '$.series.swivelForm') AS swivel_form,
       json_extract(n.payload_json, '$.series.angle') AS angle,
       json_extract(n.payload_json, '$.series.sealingForm') AS sealing_form,
       n.media_version_id AS representative_media_version_id
FROM catalog_item_current n

WHERE n.kind = 'series' AND n.product_type = 'hose_end';
--> statement-breakpoint
CREATE VIEW catalog_runtime_hose_variants AS
SELECT old.* FROM catalog_hose_variants old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.hoseSeries') AS hose_series,
       series.primary_standard AS primary_standard,
       series.equivalent_standard AS equivalent_standard,
       json_extract(n.payload_json, '$.variant.dash') AS dash,
       json_extract(n.payload_json, '$.variant.nominalIdIn') AS nominal_id_in,
       json_extract(n.payload_json, '$.variant.idMm') AS id_mm,
       json_extract(n.payload_json, '$.variant.odMm') AS od_mm,
       json_extract(n.payload_json, '$.variant.workingBar') AS working_bar,
       json_extract(n.payload_json, '$.variant.workingPsi') AS working_psi,
       json_extract(n.payload_json, '$.variant.burstBar') AS burst_bar,
       json_extract(n.payload_json, '$.variant.bendRadiusMm') AS bend_radius_mm,
       json_extract(n.payload_json, '$.variant.weightKgM') AS weight_kg_m,
       series.temp_min_c AS temp_min_c,
       series.temp_max_c AS temp_max_c,
       series.tube_material AS tube_material,
       series.reinforcement AS reinforcement,
       series.cover_material AS cover_material,
       series.cover_color AS cover_color,
       series.cover_finish AS cover_finish,
       json_extract(n.payload_json, '$.variant.skiveRequirement') AS skive_requirement,
       json_extract(n.payload_json, '$.variant.mshaMarking') AS msha_marking,
       series.fluid_compatibility AS fluid_compatibility,
       NULL AS origin,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_current n
LEFT JOIN catalog_runtime_hose_series series ON series.import_id=n.import_id AND series.series_code=json_extract(n.payload_json,'$.variant.hoseSeries')
WHERE n.kind='sku' AND n.product_type='hose';
--> statement-breakpoint
CREATE VIEW catalog_runtime_hose_ends AS
SELECT old.* FROM catalog_hose_ends old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.fittingSeries') AS fitting_series,
       json_extract(n.payload_json, '$.variant.competitorPartNumber') AS competitor_part_number,
       series.interface_family AS interface_family,
       series.connection_standard AS connection_standard,
       series.gender AS gender,
       series.swivel_form AS swivel_form,
       series.angle AS angle,
       series.sealing_form AS sealing_form,
       json_extract(n.payload_json, '$.variant.thread') AS thread,
       json_extract(n.payload_json, '$.variant.connectionDash') AS connection_dash,
       json_extract(n.payload_json, '$.variant.hoseTailDash') AS hose_tail_dash,
       json_extract(n.payload_json, '$.variant.material') AS material,
       json_extract(n.payload_json, '$.variant.coating') AS coating,
       json_extract(n.payload_json, '$.variant.saltSprayHours') AS salt_spray_hours,
       json_extract(n.payload_json, '$.variant.maxWorkingBar') AS max_working_bar,
       json_extract(n.payload_json, '$.variant.dimensionAMm') AS dimension_a_mm,
       json_extract(n.payload_json, '$.variant.cutoffBMm') AS cutoff_b_mm,
       json_extract(n.payload_json, '$.variant.hex1Mm') AS hex_1_mm,
       json_extract(n.payload_json, '$.variant.hex2Mm') AS hex_2_mm,
       json_extract(n.payload_json, '$.variant.minimumBoreMm') AS minimum_bore_mm,
       json_extract(n.payload_json, '$.variant.unitWeightG') AS unit_weight_g,
       json_extract(n.payload_json, '$.variant.drawingNumber') AS drawing_number,
       json_extract(n.payload_json, '$.variant.drawingRevision') AS drawing_revision,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_current n
LEFT JOIN catalog_runtime_hose_end_series series ON series.import_id=n.import_id AND series.series_code=json_extract(n.payload_json,'$.variant.fittingSeries')
WHERE n.kind='sku' AND n.product_type='hose_end';
--> statement-breakpoint
CREATE VIEW catalog_runtime_ferrules AS
SELECT old.* FROM catalog_ferrules old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.ferruleSeries') AS ferrule_series,
       json_extract(n.payload_json, '$.variant.hoseConstruction') AS hose_construction,
       json_extract(n.payload_json, '$.variant.hoseTailDash') AS hose_tail_dash,
       json_extract(n.payload_json, '$.variant.skiveRequirement') AS skive_requirement,
       json_extract(n.payload_json, '$.variant.material') AS material,
       json_extract(n.payload_json, '$.variant.coating') AS coating,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_current n

WHERE n.kind='sku' AND n.product_type='ferrule';
--> statement-breakpoint
CREATE VIEW catalog_runtime_adapters AS
SELECT old.* FROM catalog_adapters old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.adapterFamilyId') AS adapter_family_id,
       json_extract(n.payload_json, '$.variant.skuTemplate') AS sku_template,
       json_extract(n.payload_json, '$.variant.catalogModel') AS catalog_model,
       json_extract(n.payload_json, '$.variant.websiteProductName') AS website_product_name,
       json_extract(n.payload_json, '$.variant.shapeCode') AS shape_code,
       json_extract(n.payload_json, '$.variant.interface1') AS interface_1,
       json_extract(n.payload_json, '$.variant.connectionForm1') AS connection_form_1,
       json_extract(n.payload_json, '$.variant.size1') AS size_1,
       json_extract(n.payload_json, '$.variant.interface2') AS interface_2,
       json_extract(n.payload_json, '$.variant.connectionForm2') AS connection_form_2,
       json_extract(n.payload_json, '$.variant.size2') AS size_2,
       json_extract(n.payload_json, '$.variant.interface3') AS interface_3,
       json_extract(n.payload_json, '$.variant.connectionForm3') AS connection_form_3,
       json_extract(n.payload_json, '$.variant.size3') AS size_3,
       json_extract(n.payload_json, '$.variant.websiteDisplay') AS website_display,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_current n

WHERE n.kind='sku' AND n.product_type='adapter';
--> statement-breakpoint
CREATE VIEW catalog_runtime_quick_couplers AS
SELECT old.* FROM catalog_quick_couplers old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.skuStandardCode') AS sku_standard_code,
       json_extract(n.payload_json, '$.variant.skuRoleCode') AS sku_role_code,
       json_extract(n.payload_json, '$.variant.bodyDash') AS body_dash,
       json_extract(n.payload_json, '$.variant.portCode') AS port_code,
       json_extract(n.payload_json, '$.variant.portDash') AS port_dash,
       json_extract(n.payload_json, '$.variant.couplerSeries') AS coupler_series,
       json_extract(n.payload_json, '$.variant.role') AS role,
       json_extract(n.payload_json, '$.variant.matingSeries') AS mating_series,
       json_extract(n.payload_json, '$.variant.interchangeStandard') AS interchange_standard,
       json_extract(n.payload_json, '$.variant.bodySize') AS body_size,
       json_extract(n.payload_json, '$.variant.portInterface') AS port_interface,
       json_extract(n.payload_json, '$.variant.portGender') AS port_gender,
       json_extract(n.payload_json, '$.variant.portThread') AS port_thread,
       json_extract(n.payload_json, '$.variant.connectionMechanism') AS connection_mechanism,
       json_extract(n.payload_json, '$.variant.valving') AS valving,
       json_extract(n.payload_json, '$.variant.bodyMaterial') AS body_material,
       json_extract(n.payload_json, '$.variant.coating') AS coating,
       json_extract(n.payload_json, '$.variant.sealMaterial') AS seal_material,
       json_extract(n.payload_json, '$.variant.maxWorkingBar') AS max_working_bar,
       json_extract(n.payload_json, '$.variant.minimumBurstBar') AS minimum_burst_bar,
       json_extract(n.payload_json, '$.variant.ratedFlowLMin') AS rated_flow_l_min,
       json_extract(n.payload_json, '$.variant.pressureDropBasis') AS pressure_drop_basis,
       json_extract(n.payload_json, '$.variant.tempMinC') AS temp_min_c,
       json_extract(n.payload_json, '$.variant.tempMaxC') AS temp_max_c,
       json_extract(n.payload_json, '$.variant.overallLengthMm') AS overall_length_mm,
       json_extract(n.payload_json, '$.variant.unitWeightG') AS unit_weight_g,
       json_extract(n.payload_json, '$.variant.drawingNumber') AS drawing_number,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_current n

WHERE n.kind='sku' AND n.product_type='quick_coupler';
--> statement-breakpoint
CREATE VIEW catalog_runtime_series_commercial_rules AS
SELECT old.* FROM catalog_series_commercial_rules old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind='series' AND n.import_id=old.import_id AND n.product_type=old.product_type AND n.code=old.series_code)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.product_type AS product_type,
       n.code AS series_code,
       json_extract(n.payload_json,'$.commercialRule.salesUnit') AS sales_unit,
       json_extract(n.payload_json,'$.commercialRule.moq') AS moq,
       json_extract(n.payload_json,'$.commercialRule.leadTimeDays') AS lead_time_days,
       json_extract(n.payload_json,'$.commercialRule.countryOfOrigin') AS country_of_origin,
       json_extract(n.payload_json,'$.commercialRule.hsCode') AS hs_code,
       json_extract(n.payload_json,'$.commercialRule.notes') AS notes,
       json_extract(n.payload_json,'$.commercialRule.quantityInputMode') AS quantity_input_mode,
       json_extract(n.payload_json,'$.commercialRule.minimumLengthPerPieceFt') AS minimum_length_per_piece_ft,
       json_extract(n.payload_json,'$.commercialRule.lengthIncrementFt') AS length_increment_ft,
       json_extract(n.payload_json,'$.commercialRule.presetLength1Ft') AS preset_length_1_ft,
       json_extract(n.payload_json,'$.commercialRule.presetLength2Ft') AS preset_length_2_ft,
       json_extract(n.payload_json,'$.commercialRule.presetLength3Ft') AS preset_length_3_ft,
       json_extract(n.payload_json,'$.commercialRule.continuousLengthConfirmation') AS continuous_length_confirmation
FROM catalog_item_current n

WHERE n.kind='series';
--> statement-breakpoint
CREATE VIEW catalog_runtime_sku_price_packaging AS
SELECT old.* FROM catalog_sku_price_packaging old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       n.code AS sales_sku,
       json_extract(n.payload_json,'$.price.amount') AS reference_price_usd,
       json_extract(n.payload_json,'$.price.currency') AS currency,
       json_extract(n.payload_json,'$.price.packageLengthFt') AS package_length_ft,
       json_extract(n.payload_json,'$.price.unitsPerSalesPack') AS units_per_sales_pack,
       json_extract(n.payload_json,'$.price.netUnitWeightKg') AS net_unit_weight_kg,
       json_extract(n.payload_json,'$.price.innerPackQty') AS inner_pack_qty,
       json_extract(n.payload_json,'$.price.masterCartonQty') AS master_carton_qty,
       json_extract(n.payload_json,'$.price.cartonGrossWeightKg') AS carton_gross_weight_kg,
       json_extract(n.payload_json,'$.price.cartonLCm') AS carton_l_cm,
       json_extract(n.payload_json,'$.price.cartonWCm') AS carton_w_cm,
       json_extract(n.payload_json,'$.price.cartonHCm') AS carton_h_cm,
       json_extract(n.payload_json,'$.price.packingBasis') AS packing_basis
FROM catalog_item_current n

WHERE n.kind='sku';
--> statement-breakpoint
CREATE VIEW catalog_runtime_sales_offers AS
SELECT old.* FROM catalog_sales_offers old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.base_sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS base_sku,
       n.code AS sales_sku,
       CASE n.product_type WHEN 'hose' THEN 'Hose Variant' WHEN 'hose_end' THEN 'Hose End' WHEN 'ferrule' THEN 'Ferrule' WHEN 'adapter' THEN 'Adapter' ELSE 'Quick Coupler' END AS product_type,
       rule.sales_unit AS sales_unit,
       json_extract(n.payload_json,'$.price.packageLengthFt') AS package_length_ft,
       json_extract(n.payload_json,'$.price.unitsPerSalesPack') AS units_per_sales_pack,
       rule.moq AS moq,
       json_extract(n.payload_json,'$.price.netUnitWeightKg') AS net_unit_weight_kg,
       rule.lead_time_days AS lead_time_days,
       rule.country_of_origin AS country_of_origin,
       json_extract(n.payload_json,'$.price.currency') AS currency,
       json_extract(n.payload_json,'$.price.amount') AS reference_price_usd,
       json_extract(n.payload_json,'$.price.innerPackQty') AS inner_pack_qty,
       json_extract(n.payload_json,'$.price.masterCartonQty') AS master_carton_qty,
       json_extract(n.payload_json,'$.price.cartonGrossWeightKg') AS carton_gross_weight_kg,
       json_extract(n.payload_json,'$.price.cartonLCm') AS carton_l_cm,
       json_extract(n.payload_json,'$.price.cartonWCm') AS carton_w_cm,
       json_extract(n.payload_json,'$.price.cartonHCm') AS carton_h_cm,
       json_extract(n.payload_json,'$.price.packingBasis') AS packing_basis,
       rule.hs_code AS hs_code,
       rule.notes AS notes,
       CASE n.target_state WHEN 'online' THEN 'Published' WHEN 'draft' THEN 'Draft' ELSE 'Archived' END AS catalog_publication_status,
       CASE n.target_state WHEN 'online' THEN 'Eligible' ELSE 'Blocked' END AS rfq_eligibility,
       COALESCE(json_extract(n.payload_json,'$.variant.technicalDataStatus'),'Complete') AS technical_data_status,
       rule.quantity_input_mode AS quantity_input_mode,
       rule.minimum_length_per_piece_ft AS minimum_length_per_piece_ft,
       rule.length_increment_ft AS length_increment_ft,
       rule.preset_length_1_ft AS preset_length_1_ft,
       rule.preset_length_2_ft AS preset_length_2_ft,
       rule.preset_length_3_ft AS preset_length_3_ft,
       rule.continuous_length_confirmation AS continuous_length_confirmation
FROM catalog_item_current n
LEFT JOIN catalog_runtime_series_commercial_rules rule ON rule.import_id=n.import_id AND rule.product_type=n.product_type AND rule.series_code=CASE n.product_type WHEN 'hose' THEN json_extract(n.payload_json, '$.variant.hoseSeries') WHEN 'hose_end' THEN json_extract(n.payload_json, '$.variant.fittingSeries') WHEN 'ferrule' THEN json_extract(n.payload_json, '$.variant.ferruleSeries') WHEN 'adapter' THEN json_extract(n.payload_json, '$.variant.adapterFamilyId') WHEN 'quick_coupler' THEN json_extract(n.payload_json, '$.variant.couplerSeries') END
WHERE n.kind='sku';
--> statement-breakpoint
CREATE VIEW catalog_runtime_product_main_images AS
SELECT old.* FROM catalog_product_main_images old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       n.media_version_id AS media_version_id,
       n.occurred_at AS assigned_at,
       n.actor_id AS assigned_by,
       'override' AS assignment_kind
FROM catalog_item_current n

WHERE n.kind='sku';
--> statement-breakpoint
UPDATE application_schema_state SET version=55, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;

DROP TRIGGER catalog_item_revision_apply;
CREATE TRIGGER catalog_item_revision_apply AFTER INSERT ON catalog_product_revisions
BEGIN
  UPDATE catalog_product_entities SET
    current_revision_id = CASE WHEN NEW.target_state <> 'draft' THEN NEW.id ELSE current_revision_id END,
    draft_revision_id = CASE WHEN NEW.target_state = 'draft' THEN NEW.id ELSE NULL END
  WHERE id = NEW.entity_id;
  UPDATE catalog_product_entities SET hidden_at=NEW.occurred_at WHERE id=NEW.entity_id AND json_extract(NEW.source_json, '$.operation')='delete';
  UPDATE catalog_product_change_requests SET status='deleted'
    WHERE status='pending' AND json_extract(NEW.source_json,'$.operation')='delete'
      AND json_extract(payload_json,'$.payload.kind')='sku'
      AND json_extract(payload_json,'$.payload.productType')=(SELECT product_type FROM catalog_product_entities WHERE id=NEW.entity_id)
      AND json_extract(payload_json,'$.payload.variant.sku')=(SELECT code FROM catalog_product_entities WHERE id=NEW.entity_id);
  UPDATE catalog_item_publication_state SET generation = generation + 1 WHERE singleton = 1;
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

CREATE TRIGGER catalog_item_delete_precondition BEFORE INSERT ON catalog_product_deletions
BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_item_publication_state WHERE mode='items' AND generation=NEW.expected_generation) THEN RAISE(ABORT,'catalog changed during deletion') END;
 SELECT CASE WHEN EXISTS (
   SELECT 1 FROM catalog_item_pending_requests request, json_each(NEW.payload_json,'$.targets') target
   WHERE request.product_type=json_extract(target.value,'$.productType')
     AND ((request.kind=json_extract(target.value,'$.kind') AND request.code=json_extract(target.value,'$.code'))
       OR (json_extract(target.value,'$.kind')='series' AND request.kind='sku' AND request.series_code=json_extract(target.value,'$.code')))
     AND request.id NOT IN (SELECT value FROM json_each(NEW.payload_json,'$.requestIds'))
 ) THEN RAISE(ABORT,'pending requests changed during deletion') END;
 SELECT CASE WHEN EXISTS (
   SELECT 1 FROM catalog_product_change_requests request,json_each(request.dependencies_json) dependency
   WHERE request.status='pending' AND request.id NOT IN (SELECT value FROM json_each(NEW.payload_json,'$.requestIds'))
     AND dependency.value IN (SELECT value FROM json_each(NEW.payload_json,'$.requestIds'))
 ) THEN RAISE(ABORT,'dependent requests prevent deletion') END;
END;
CREATE TRIGGER catalog_item_hidden_revision BEFORE INSERT ON catalog_product_revisions
WHEN EXISTS (SELECT 1 FROM catalog_product_entities e WHERE e.id=NEW.entity_id AND e.hidden_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'deleted product identity is retained'); END;
CREATE TRIGGER catalog_item_delete_request_guard BEFORE INSERT ON catalog_product_change_requests
BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.dependencies_json) d JOIN catalog_product_change_requests p ON p.id=d.value WHERE p.status='deleted') THEN RAISE(ABORT,'dependency was deleted') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM catalog_product_entities e WHERE e.hidden_at IS NOT NULL
 AND e.kind=json_extract(NEW.payload_json,'$.payload.kind') AND e.product_type=json_extract(NEW.payload_json,'$.payload.productType')
 AND e.code=COALESCE(json_extract(NEW.payload_json,'$.payload.variant.sku'),json_extract(NEW.payload_json,'$.payload.series.seriesCode')))
 THEN RAISE(ABORT,'product was deleted') END;
END;

CREATE TRIGGER catalog_item_sku_delete_dependencies BEFORE INSERT ON catalog_product_revisions
WHEN json_extract(NEW.source_json,'$.operation')='delete'
BEGIN
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM catalog_product_change_requests dependent, json_each(dependent.dependencies_json) dep
  JOIN catalog_product_change_requests target ON target.id=dep.value
  JOIN catalog_product_entities entity ON entity.id=NEW.entity_id
  WHERE dependent.status='pending' AND target.status='pending'
   AND json_extract(target.payload_json,'$.payload.variant.sku')=entity.code
   AND json_extract(target.payload_json,'$.payload.productType')=entity.product_type
   AND COALESCE(json_extract(dependent.payload_json,'$.payload.variant.sku'),'')<>entity.code
 ) THEN RAISE(ABORT,'dependent requests prevent deletion') END;
END;

CREATE VIEW catalog_item_pending_requests AS
SELECT id, json_extract(payload_json,'$.payload.kind') AS kind,
 json_extract(payload_json,'$.payload.productType') AS product_type,
 COALESCE(json_extract(payload_json,'$.payload.variant.sku'),json_extract(payload_json,'$.payload.series.seriesCode')) AS code,
 json_extract(payload_json, CASE json_extract(payload_json, '$.payload.productType') WHEN 'hose' THEN '$.payload.variant.hoseSeries' WHEN 'hose_end' THEN '$.payload.variant.fittingSeries' WHEN 'ferrule' THEN '$.payload.variant.ferruleSeries' WHEN 'adapter' THEN '$.payload.variant.adapterFamilyId' WHEN 'quick_coupler' THEN '$.payload.variant.couplerSeries' END) AS series_code
FROM catalog_product_change_requests WHERE status='pending';
CREATE TRIGGER catalog_request_deleted_parent BEFORE INSERT ON catalog_product_change_requests
WHEN json_extract(NEW.payload_json,'$.payload.kind')='sku'
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM catalog_product_entities e WHERE e.kind='series' AND e.hidden_at IS NOT NULL AND e.product_type=json_extract(NEW.payload_json,'$.payload.productType') AND e.code=json_extract(NEW.payload_json, CASE json_extract(NEW.payload_json, '$.payload.productType') WHEN 'hose' THEN '$.payload.variant.hoseSeries' WHEN 'hose_end' THEN '$.payload.variant.fittingSeries' WHEN 'ferrule' THEN '$.payload.variant.ferruleSeries' WHEN 'adapter' THEN '$.payload.variant.adapterFamilyId' WHEN 'quick_coupler' THEN '$.payload.variant.couplerSeries' END)) THEN RAISE(ABORT,'parent series was deleted') END;
END;
CREATE TRIGGER catalog_revision_deleted_parent BEFORE INSERT ON catalog_product_revisions
WHEN json_extract(NEW.payload_json,'$.kind')='sku'
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM catalog_product_entities e WHERE e.kind='series' AND e.hidden_at IS NOT NULL AND e.product_type=json_extract(NEW.payload_json,'$.productType') AND e.code=json_extract(NEW.payload_json, CASE json_extract(NEW.payload_json, '$.productType') WHEN 'hose' THEN '$.variant.hoseSeries' WHEN 'hose_end' THEN '$.variant.fittingSeries' WHEN 'ferrule' THEN '$.variant.ferruleSeries' WHEN 'adapter' THEN '$.variant.adapterFamilyId' WHEN 'quick_coupler' THEN '$.variant.couplerSeries' END)) THEN RAISE(ABORT,'parent series was deleted') END;
END;
