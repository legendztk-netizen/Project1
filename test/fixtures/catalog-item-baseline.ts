export async function seedCatalogItemBaseline(
  database: D1Database,
  privateCost: number | null = null,
) {
  const now = "2026-09-04T00:00:00.000Z";
  const summary = JSON.stringify({
    adapterCount: 0,
    adapterFamilyCount: 0,
    compatibilityCount: 0,
    costBasisPriceCount: 0,
    ferruleCount: 0,
    hoseEndCount: 0,
    hoseSeriesCount: 1,
    hoseVariantCount: 1,
    quickCouplerCount: 0,
    referencePriceCount: 1,
    salesOfferCount: 1,
    skuCount: 1,
  });
  await database.batch([
    database
      .prepare(
        `INSERT INTO catalog_imports (
               id, kind, status, source_file_name, source_file_size_bytes,
               summary_json, error_count, warning_count, created_at, completed_at
             ) VALUES ('active-import', 'workbook', 'completed', 'seed.xlsx', 1,
                       ?, 0, 0, ?, ?)`,
      )
      .bind(summary, now, now),
    database.prepare(
      `INSERT INTO catalog_media_lineages
             (id, logical_reference, created_at, created_by)
           VALUES ('approved:hose-series:601R1', 'hose-series:601R1',
                   '2026-09-04T00:00:00.000Z', 'test')`,
    ),
    database.prepare(
      `INSERT INTO catalog_media_versions
             (id, lineage_id, version, source_kind, approved_reference,
              mime_type, created_at, created_by)
           VALUES ('approved-v1:hose-series:601R1', 'approved:hose-series:601R1', 1,
                   'approved_reference', 'hose-series:601R1', 'reference',
                   '2026-09-04T00:00:00.000Z', 'test')`,
    ),
    database.prepare(
      `INSERT INTO catalog_media_versions
             (id, lineage_id, version, source_kind, approved_reference,
              master_object_key, storefront_object_key, thumbnail_object_key,
              content_hash, mime_type, width, height, created_at, created_by)
           VALUES ('uploaded-v2', 'approved:hose-series:601R1', 2,
                   'uploaded', NULL, 'catalog/master/v2.png',
                   'catalog/storefront/v2.webp', 'catalog/thumb/v2.webp',
                   'sha256-v2', 'image/webp', 1200, 800,
                   '2026-09-04T00:30:00.000Z', 'owner-1')`,
    ),
    database.prepare(
      `INSERT INTO catalog_skus (
             id, import_id, sku, source_worksheet, product_type, hose_series,
             catalog_publication_status, rfq_eligibility,
             technical_data_status, supply_availability
           ) VALUES ('active-sku', 'active-import', '601R1_001',
                     '01_胶管主数据', 'hose', '601R1', 'Published', 'Eligible',
                     'Complete', 'available_for_quote')`,
    ),
    database.prepare(
      `INSERT INTO catalog_hose_series (
             id, import_id, series_code, series_name, primary_standard,
             equivalent_standard, temp_min_c, temp_max_c,
             representative_media_version_id
           ) VALUES ('active-series', 'active-import', '601R1', '601R1',
                     'SAE 100R1AT', 'EN 853 1SN', -40, 100,
                     'approved-v1:hose-series:601R1')`,
    ),
    database.prepare(
      `INSERT INTO catalog_product_main_images (
             id, import_id, sku, media_version_id, assigned_at, assigned_by,
             assignment_kind
           ) VALUES ('active-image', 'active-import', '601R1_001',
                     'approved-v1:hose-series:601R1',
                     '2026-09-04T00:00:00.000Z', 'test', 'inherited')`,
    ),
    database.prepare(
      `INSERT INTO catalog_hose_variants (
             id, import_id, sku, hose_series, primary_standard,
             equivalent_standard, dash, nominal_id_in, id_mm, od_mm,
             working_bar, working_psi, burst_bar, bend_radius_mm, weight_kg_m,
             temp_min_c, temp_max_c, tube_material, reinforcement,
             cover_material, cover_color, cover_finish, skive_requirement,
             msha_marking, fluid_compatibility, origin, source, notes
           ) VALUES (
             'active-hose', 'active-import', '601R1_001', '601R1', 'SAE 100R1AT',
             'EN 853 1SN', '-4', 0.25, 6.4, 13.4, 180, 2610, 720, 100, 0.2,
             -40, 100, 'Synthetic rubber', 'One wire braid', 'Synthetic rubber',
             'Black', 'Wrapped', 'No Skive', 'N/A', 'Hydraulic oil', 'China',
             'Seed source', NULL
           )`,
    ),
    database.prepare(
      `INSERT INTO catalog_sales_offers (
             id, import_id, base_sku, sales_sku, product_type, sales_unit,
             package_length_ft, units_per_sales_pack, moq, net_unit_weight_kg,
             lead_time_days, country_of_origin, currency, reference_price_usd,
             inner_pack_qty, master_carton_qty, carton_gross_weight_kg,
             carton_l_cm, carton_w_cm, carton_h_cm, packing_basis, hs_code,
             notes, catalog_publication_status, rfq_eligibility,
             technical_data_status, quantity_input_mode,
             minimum_length_per_piece_ft, length_increment_ft,
             preset_length_1_ft, preset_length_2_ft, preset_length_3_ft,
             continuous_length_confirmation
           ) VALUES (
             'active-offer', 'active-import', '601R1_001', '601R1_001',
             'Hose Variant', 'ft', NULL, 1, 1, 0.2, 14, 'China', 'USD', 3.25,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Published',
             'Eligible', 'Complete', 'Length x Pieces', 1, 1, 5, 10, 20, NULL
           )`,
    ),
    database
      .prepare(
        `INSERT INTO catalog_cost_bases (
             id, import_id, sales_sku, currency, factory_unit_price,
             price_incoterm, incoterm_place, tier_qty, tier_price
           ) VALUES ('active-cost', 'active-import', '601R1_001', 'USD',
                     ?, NULL, NULL, NULL, NULL)`,
      )
      .bind(privateCost),
    database.prepare(`INSERT INTO catalog_series_commercial_rules
    (id,import_id,product_type,series_code,sales_unit,moq,lead_time_days,country_of_origin,quantity_input_mode,minimum_length_per_piece_ft,length_increment_ft)
    VALUES ('rule','active-import','hose','601R1','ft',1,14,'China','Length x Pieces',1,1)`),
    database
      .prepare(
        `INSERT INTO catalog_releases (
               id, release_number, status, source_import_id,
               version, created_at, published_at
             ) VALUES ('active-release', 'ACTIVE-1', 'draft', 'active-import',
                       1, ?, NULL)`,
      )
      .bind(now),
    database
      .prepare(
        `UPDATE catalog_releases
             SET status = 'published', version = version + 1, published_at = ?
             WHERE id = 'active-release'`,
      )
      .bind(now),
    database
      .prepare(
        `UPDATE catalog_active_release
             SET release_id = 'active-release', version = version + 1,
                 updated_at = ?
             WHERE singleton = 1`,
      )
      .bind(now),
  ]);
}
