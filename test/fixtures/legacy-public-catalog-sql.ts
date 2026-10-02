// Reference implementation (oracle) of the public catalog read, kept verbatim from before the read-cost
// optimization. The tests compare the optimized reader against this single join query row by row; it is not
// used by the application because SQLite scans every materialized CTE once per SKU (quadratic rows read).
export function legacyPublicCatalogSql(singleItem: boolean) {
  const skuFilter = singleItem ? "AND sku = ?1" : "";
  const baseSkuFilter = singleItem ? "AND base_sku = ?1" : "";

  return `
WITH active_catalog_runtime_skus AS MATERIALIZED (
    SELECT * FROM catalog_runtime_skus
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
    ${skuFilter}
  ),
active_catalog_runtime_sales_offers AS MATERIALIZED (
    SELECT * FROM catalog_runtime_sales_offers
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
    ${baseSkuFilter}
  ),
active_catalog_runtime_product_main_images AS MATERIALIZED (
    SELECT * FROM catalog_runtime_product_main_images
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
    ${skuFilter}
  ),
active_catalog_runtime_hose_variants AS MATERIALIZED (
    SELECT * FROM catalog_runtime_hose_variants
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
    ${skuFilter}
  ),
active_catalog_runtime_hose_series AS MATERIALIZED (
    SELECT * FROM catalog_runtime_hose_series
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
  ),
active_catalog_runtime_hose_ends AS MATERIALIZED (
    SELECT * FROM catalog_runtime_hose_ends
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
    ${skuFilter}
  ),
active_catalog_runtime_hose_end_series AS MATERIALIZED (
    SELECT * FROM catalog_runtime_hose_end_series
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
  ),
active_catalog_runtime_ferrules AS MATERIALIZED (
    SELECT * FROM catalog_runtime_ferrules
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
    ${skuFilter}
  ),
active_catalog_runtime_adapters AS MATERIALIZED (
    SELECT * FROM catalog_runtime_adapters
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
    ${skuFilter}
  ),
active_catalog_runtime_quick_couplers AS MATERIALIZED (
    SELECT * FROM catalog_runtime_quick_couplers
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
    ${skuFilter}
  ),
active_catalog_runtime_series_commercial_rules AS MATERIALIZED (
    SELECT * FROM catalog_runtime_series_commercial_rules
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
  ),
active_catalog_runtime_sku_price_packaging AS MATERIALIZED (
    SELECT * FROM catalog_runtime_sku_price_packaging
    WHERE import_id = (
      SELECT r.source_import_id FROM catalog_active_release ar
      JOIN catalog_releases r ON r.id = ar.release_id
    )
    ${skuFilter}
  )
  SELECT CASE WHEN item_state.mode = 'items' THEN item_state.generation END AS item_generation,
         item_entity.current_revision_id AS item_revision_id,
         series_entity.current_revision_id AS series_revision_id,
         r.id AS release_id, r.release_number, s.sku, s.product_type, s.hose_series,
         s.rfq_eligibility, s.supply_availability,
         selected_media.id AS main_image_version_id,
         selected_media.approved_reference AS main_image_approved_reference,
         COALESCE(commercial_rule.sales_unit, o.sales_unit) AS sales_unit,
         COALESCE(commercial_rule.moq, o.moq) AS moq,
         COALESCE(commercial_rule.lead_time_days, o.lead_time_days) AS lead_time_days,
         CASE WHEN exact_price.id IS NOT NULL THEN exact_price.currency ELSE o.currency END AS currency,
         CASE WHEN exact_price.id IS NOT NULL THEN exact_price.reference_price_usd ELSE o.reference_price_usd END AS reference_price_usd,
         COALESCE(commercial_rule.quantity_input_mode, o.quantity_input_mode) AS quantity_input_mode,
         CASE WHEN commercial_rule.id IS NOT NULL THEN commercial_rule.minimum_length_per_piece_ft ELSE o.minimum_length_per_piece_ft END AS minimum_length_per_piece_ft,
         CASE WHEN commercial_rule.id IS NOT NULL THEN commercial_rule.length_increment_ft ELSE o.length_increment_ft END AS length_increment_ft,
         CASE WHEN commercial_rule.id IS NOT NULL THEN commercial_rule.preset_length_1_ft ELSE o.preset_length_1_ft END AS preset_length_1_ft,
         CASE WHEN commercial_rule.id IS NOT NULL THEN commercial_rule.preset_length_2_ft ELSE o.preset_length_2_ft END AS preset_length_2_ft,
         CASE WHEN commercial_rule.id IS NOT NULL THEN commercial_rule.preset_length_3_ft ELSE o.preset_length_3_ft END AS preset_length_3_ft,
         COALESCE(series_fee.rate_per_piece, global_fee.rate_per_piece) AS cutting_labeling_fee_rate,
         COALESCE(series_fee.scope_key, global_fee.scope_key) AS cutting_labeling_fee_scope,
         COALESCE(series_fee.version, global_fee.version) AS cutting_labeling_fee_version,
         hs.primary_standard, hs.equivalent_standard, h.dash,
         h.nominal_id_in, h.id_mm, h.od_mm, h.working_bar, h.working_psi,
         h.burst_bar, h.bend_radius_mm,
         h.weight_kg_m AS hose_weight_kg_m,
         hs.temp_min_c AS hose_temp_min_c,
         hs.temp_max_c AS hose_temp_max_c, hs.tube_material,
         hs.reinforcement, hs.cover_material, hs.cover_color, hs.cover_finish,
         hs.fluid_compatibility,
         e.fitting_series, e.competitor_part_number, hes.interface_family,
         hes.connection_standard, hes.gender,
         hes.swivel_form, hes.angle, hes.sealing_form, e.thread,
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
  INNER JOIN active_catalog_runtime_skus s ON s.import_id = r.source_import_id
  LEFT JOIN catalog_item_publication_state item_state ON item_state.singleton = 1
  LEFT JOIN catalog_product_entities item_entity ON item_entity.kind = 'sku' AND item_entity.code = s.sku AND item_entity.product_type = s.product_type
  LEFT JOIN active_catalog_runtime_sales_offers o
    ON o.import_id = s.import_id AND o.base_sku = s.sku
  LEFT JOIN active_catalog_runtime_product_main_images image
    ON image.import_id = s.import_id AND image.sku = s.sku
   AND image.assignment_kind = 'override'
  LEFT JOIN cutting_labeling_fee_rates global_fee
    ON global_fee.scope_key = 'global'
  LEFT JOIN cutting_labeling_fee_rates series_fee
    ON series_fee.scope_key = 'series:' || s.hose_series
  LEFT JOIN active_catalog_runtime_hose_variants h
    ON h.import_id = s.import_id AND h.sku = s.sku
  LEFT JOIN active_catalog_runtime_hose_series hs
    ON hs.import_id = h.import_id AND hs.series_code = h.hose_series
  LEFT JOIN active_catalog_runtime_hose_ends e
    ON e.import_id = s.import_id AND e.sku = s.sku
  LEFT JOIN active_catalog_runtime_hose_end_series hes
    ON hes.import_id = e.import_id AND hes.series_code = e.fitting_series
  LEFT JOIN active_catalog_runtime_ferrules f
    ON f.import_id = s.import_id AND f.sku = s.sku
  LEFT JOIN active_catalog_runtime_adapters a
    ON a.import_id = s.import_id AND a.sku = s.sku
  LEFT JOIN active_catalog_runtime_quick_couplers q
    ON q.import_id = s.import_id AND q.sku = s.sku
  LEFT JOIN catalog_product_entities series_entity ON series_entity.kind = 'series' AND series_entity.code = COALESCE(s.hose_series,e.fitting_series,f.ferrule_series,a.adapter_family_id,q.coupler_series) AND series_entity.product_type = s.product_type
  LEFT JOIN catalog_product_revisions series_revision ON series_revision.id = series_entity.current_revision_id
  LEFT JOIN catalog_media_versions selected_media
    ON selected_media.id = COALESCE(image.media_version_id,
                                    hs.representative_media_version_id,
                                    hes.representative_media_version_id,
                                    series_revision.media_version_id)
  LEFT JOIN active_catalog_runtime_series_commercial_rules commercial_rule
    ON commercial_rule.import_id = s.import_id
   AND commercial_rule.product_type = s.product_type
   AND commercial_rule.series_code = CASE s.product_type
     WHEN 'hose' THEN h.hose_series
     WHEN 'hose_end' THEN e.fitting_series
     WHEN 'ferrule' THEN f.ferrule_series
     WHEN 'adapter' THEN a.adapter_family_id
     WHEN 'quick_coupler' THEN q.coupler_series
   END
  LEFT JOIN active_catalog_runtime_sku_price_packaging exact_price
    ON exact_price.import_id = s.import_id AND exact_price.sku = s.sku
  WHERE ar.singleton = 1
    AND r.status = 'published'
    AND s.catalog_publication_status = 'Published'
    ${singleItem ? "AND s.sku = ?1" : ""}
  ORDER BY s.product_type, s.sku`;
}
