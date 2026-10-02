// Reference implementation (oracle) of the admin product list SKU rows, kept verbatim from before the
// read-cost optimization: one join of the facts CTE against the runtime views, which SQLite evaluates as a
// nested scan per SKU. The tests compare the optimized reader against this statement.
export const legacyFacts = `
 SELECT 'hose' AS type,m.sku,m.hose_series AS series_code,COALESCE(CAST(m.nominal_id_in AS TEXT)||' in','')||COALESCE(' · '||m.working_bar||' bar','') AS dimensions FROM catalog_runtime_hose_variants m WHERE m.import_id=?1
 UNION ALL SELECT 'hose_end',m.sku,m.fitting_series,COALESCE(m.connection_dash,'?')||' / '||COALESCE(m.hose_tail_dash,'?')||COALESCE(' · '||m.thread,'') FROM catalog_runtime_hose_ends m WHERE m.import_id=?1
 UNION ALL SELECT 'ferrule',m.sku,m.ferrule_series,COALESCE(m.hose_tail_dash,'?')||' / '||COALESCE(m.hose_construction,'') FROM catalog_runtime_ferrules m WHERE m.import_id=?1
 UNION ALL SELECT 'adapter',m.sku,m.adapter_family_id,m.interface_1||' '||COALESCE(m.size_1,'')||' / '||m.interface_2||' '||COALESCE(m.size_2,'') FROM catalog_runtime_adapters m WHERE m.import_id=?1
 UNION ALL SELECT 'quick_coupler',m.sku,m.coupler_series,COALESCE(m.body_size,'?')||' / '||COALESCE(m.port_thread,'?')||COALESCE(' · '||m.max_working_bar||' bar','') FROM catalog_runtime_quick_couplers m WHERE m.import_id=?1`;

export const legacyManagedSkuRowsSql = `WITH product_facts AS MATERIALIZED (${legacyFacts})
    SELECT f.*,s.catalog_publication_status,COALESCE(p.currency,o.currency,'USD') AS currency,CASE WHEN p.id IS NOT NULL THEN p.reference_price_usd ELSE o.reference_price_usd END AS amount,image.media_version_id,
    e.current_revision_id,e.draft_revision_id,o.sales_unit,s.technical_data_status,d.invalidated_sequence>d.generated_sequence AS dirty
    FROM product_facts f JOIN catalog_runtime_skus s ON s.sku=f.sku AND s.import_id=?1
    LEFT JOIN catalog_product_entities e ON e.kind='sku' AND e.code=f.sku
    LEFT JOIN catalog_runtime_sku_price_packaging p ON p.sku=f.sku AND p.import_id=?1
    LEFT JOIN catalog_runtime_sales_offers o ON o.base_sku=f.sku AND o.import_id=?1
    LEFT JOIN catalog_runtime_product_main_images image ON image.sku=f.sku AND image.import_id=?1
    LEFT JOIN catalog_item_assembly_state d ON d.hose_series=f.series_code AND f.type='hose'
    WHERE e.hidden_at IS NULL`;
