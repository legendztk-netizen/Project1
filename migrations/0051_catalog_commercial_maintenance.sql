-- Spec 9 Ticket 04: separate continuously inherited series commercial rules
-- from exact-SKU retail price and optional packaging data.

CREATE TABLE `catalog_series_commercial_rules` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `import_id` TEXT NOT NULL,
  `product_type` TEXT NOT NULL CHECK (`product_type` IN ('hose', 'hose_end', 'ferrule', 'adapter', 'quick_coupler')),
  `series_code` TEXT NOT NULL,
  `sales_unit` TEXT NOT NULL,
  `moq` REAL NOT NULL CHECK (`moq` >= 0),
  `lead_time_days` REAL NOT NULL CHECK (`lead_time_days` >= 0),
  `country_of_origin` TEXT NOT NULL,
  `hs_code` TEXT,
  `notes` TEXT,
  `quantity_input_mode` TEXT NOT NULL,
  `minimum_length_per_piece_ft` REAL CHECK (`minimum_length_per_piece_ft` IS NULL OR `minimum_length_per_piece_ft` >= 0),
  `length_increment_ft` REAL CHECK (`length_increment_ft` IS NULL OR `length_increment_ft` >= 0),
  `preset_length_1_ft` REAL CHECK (`preset_length_1_ft` IS NULL OR `preset_length_1_ft` >= 0),
  `preset_length_2_ft` REAL CHECK (`preset_length_2_ft` IS NULL OR `preset_length_2_ft` >= 0),
  `preset_length_3_ft` REAL CHECK (`preset_length_3_ft` IS NULL OR `preset_length_3_ft` >= 0),
  `continuous_length_confirmation` TEXT,
  FOREIGN KEY (`import_id`) REFERENCES `catalog_imports`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_series_commercial_rules_import_series_uq`
ON `catalog_series_commercial_rules` (`import_id`, `product_type`, `series_code`);
--> statement-breakpoint

CREATE TABLE `catalog_sku_price_packaging` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `import_id` TEXT NOT NULL,
  `sku` TEXT NOT NULL,
  `sales_sku` TEXT NOT NULL CHECK (`sales_sku` = `sku`),
  `reference_price_usd` REAL CHECK (`reference_price_usd` IS NULL OR `reference_price_usd` >= 0),
  `currency` TEXT NOT NULL DEFAULT 'USD' CHECK (`currency` = 'USD'),
  `package_length_ft` REAL CHECK (`package_length_ft` IS NULL OR `package_length_ft` >= 0),
  `units_per_sales_pack` REAL CHECK (`units_per_sales_pack` IS NULL OR `units_per_sales_pack` >= 0),
  `net_unit_weight_kg` REAL CHECK (`net_unit_weight_kg` IS NULL OR `net_unit_weight_kg` >= 0),
  `inner_pack_qty` REAL CHECK (`inner_pack_qty` IS NULL OR `inner_pack_qty` >= 0),
  `master_carton_qty` REAL CHECK (`master_carton_qty` IS NULL OR `master_carton_qty` >= 0),
  `carton_gross_weight_kg` REAL CHECK (`carton_gross_weight_kg` IS NULL OR `carton_gross_weight_kg` >= 0),
  `carton_l_cm` REAL CHECK (`carton_l_cm` IS NULL OR `carton_l_cm` >= 0),
  `carton_w_cm` REAL CHECK (`carton_w_cm` IS NULL OR `carton_w_cm` >= 0),
  `carton_h_cm` REAL CHECK (`carton_h_cm` IS NULL OR `carton_h_cm` >= 0),
  `packing_basis` TEXT,
  FOREIGN KEY (`import_id`, `sku`) REFERENCES `catalog_skus`(`import_id`, `sku`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_sku_price_packaging_import_sku_uq`
ON `catalog_sku_price_packaging` (`import_id`, `sku`);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_sku_price_packaging_import_sales_sku_uq`
ON `catalog_sku_price_packaging` (`import_id`, `sales_sku`);
--> statement-breakpoint
CREATE INDEX `catalog_sku_price_packaging_public_price_idx`
ON `catalog_sku_price_packaging` (`import_id`, `reference_price_usd`);
--> statement-breakpoint

-- Preserve all workbook and earlier manual data. Shared values are selected
-- deterministically once per series; SKU-owned values remain one row per SKU.
INSERT INTO `catalog_series_commercial_rules` (
  `id`, `import_id`, `product_type`, `series_code`, `sales_unit`, `moq`,
  `lead_time_days`, `country_of_origin`, `hs_code`, `notes`,
  `quantity_input_mode`, `minimum_length_per_piece_ft`, `length_increment_ft`,
  `preset_length_1_ft`, `preset_length_2_ft`, `preset_length_3_ft`,
  `continuous_length_confirmation`
)
SELECT
  'commercial-rule:' || `ranked`.`import_id` || ':' || `ranked`.`rule_product_type` || ':' || `ranked`.`series_code`,
  `ranked`.`import_id`, `ranked`.`rule_product_type`, `ranked`.`series_code`,
  `ranked`.`sales_unit`, `ranked`.`moq`, `ranked`.`lead_time_days`,
  `ranked`.`country_of_origin`, `ranked`.`hs_code`, `ranked`.`notes`,
  `ranked`.`quantity_input_mode`, `ranked`.`minimum_length_per_piece_ft`,
  `ranked`.`length_increment_ft`, `ranked`.`preset_length_1_ft`,
  `ranked`.`preset_length_2_ft`, `ranked`.`preset_length_3_ft`,
  `ranked`.`continuous_length_confirmation`
FROM (
  SELECT `offer`.*, `product`.`product_type` AS `rule_product_type`,
    CASE `product`.`product_type`
      WHEN 'hose' THEN `hose`.`hose_series`
      WHEN 'hose_end' THEN `hose_end`.`fitting_series`
      WHEN 'ferrule' THEN `ferrule`.`ferrule_series`
      WHEN 'adapter' THEN `adapter`.`adapter_family_id`
      WHEN 'quick_coupler' THEN `coupler`.`coupler_series`
    END AS `series_code`,
    ROW_NUMBER() OVER (
      PARTITION BY `offer`.`import_id`, `product`.`product_type`,
        CASE `product`.`product_type`
          WHEN 'hose' THEN `hose`.`hose_series`
          WHEN 'hose_end' THEN `hose_end`.`fitting_series`
          WHEN 'ferrule' THEN `ferrule`.`ferrule_series`
          WHEN 'adapter' THEN `adapter`.`adapter_family_id`
          WHEN 'quick_coupler' THEN `coupler`.`coupler_series`
        END
      ORDER BY `offer`.`base_sku`
    ) AS `series_rank`
  FROM `catalog_sales_offers` AS `offer`
  INNER JOIN `catalog_skus` AS `product`
    ON `product`.`import_id` = `offer`.`import_id` AND `product`.`sku` = `offer`.`base_sku`
  LEFT JOIN `catalog_hose_variants` AS `hose`
    ON `hose`.`import_id` = `product`.`import_id` AND `hose`.`sku` = `product`.`sku`
  LEFT JOIN `catalog_hose_ends` AS `hose_end`
    ON `hose_end`.`import_id` = `product`.`import_id` AND `hose_end`.`sku` = `product`.`sku`
  LEFT JOIN `catalog_ferrules` AS `ferrule`
    ON `ferrule`.`import_id` = `product`.`import_id` AND `ferrule`.`sku` = `product`.`sku`
  LEFT JOIN `catalog_adapters` AS `adapter`
    ON `adapter`.`import_id` = `product`.`import_id` AND `adapter`.`sku` = `product`.`sku`
  LEFT JOIN `catalog_quick_couplers` AS `coupler`
    ON `coupler`.`import_id` = `product`.`import_id` AND `coupler`.`sku` = `product`.`sku`
) AS `ranked`
WHERE `ranked`.`series_rank` = 1 AND NULLIF(trim(`ranked`.`series_code`), '') IS NOT NULL;
--> statement-breakpoint

INSERT INTO `catalog_sku_price_packaging` (
  `id`, `import_id`, `sku`, `sales_sku`, `reference_price_usd`, `currency`,
  `package_length_ft`, `units_per_sales_pack`, `net_unit_weight_kg`,
  `inner_pack_qty`, `master_carton_qty`, `carton_gross_weight_kg`,
  `carton_l_cm`, `carton_w_cm`, `carton_h_cm`, `packing_basis`
)
SELECT
  'sku-price:' || `import_id` || ':' || `base_sku`, `import_id`, `base_sku`,
  `base_sku`, `reference_price_usd`, 'USD', `package_length_ft`,
  `units_per_sales_pack`, `net_unit_weight_kg`, `inner_pack_qty`,
  `master_carton_qty`, `carton_gross_weight_kg`, `carton_l_cm`, `carton_w_cm`,
  `carton_h_cm`, `packing_basis`
FROM `catalog_sales_offers`;
--> statement-breakpoint

CREATE TRIGGER `catalogseriescommercialrules_immutable_insert`
BEFORE INSERT ON `catalog_series_commercial_rules`
WHEN EXISTS (SELECT 1 FROM `catalog_releases` WHERE `source_import_id` = NEW.`import_id` AND `status` IN ('published', 'superseded'))
BEGIN SELECT RAISE(ABORT, 'published catalog commercial data is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `catalogseriescommercialrules_immutable_update`
BEFORE UPDATE ON `catalog_series_commercial_rules`
WHEN EXISTS (SELECT 1 FROM `catalog_releases` WHERE `source_import_id` = OLD.`import_id` AND `status` IN ('published', 'superseded'))
BEGIN SELECT RAISE(ABORT, 'published catalog commercial data is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `catalogseriescommercialrules_immutable_delete`
BEFORE DELETE ON `catalog_series_commercial_rules`
WHEN EXISTS (SELECT 1 FROM `catalog_releases` WHERE `source_import_id` = OLD.`import_id` AND `status` IN ('published', 'superseded'))
BEGIN SELECT RAISE(ABORT, 'published catalog commercial data is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `catalogskupricepackaging_immutable_insert`
BEFORE INSERT ON `catalog_sku_price_packaging`
WHEN EXISTS (SELECT 1 FROM `catalog_releases` WHERE `source_import_id` = NEW.`import_id` AND `status` IN ('published', 'superseded'))
BEGIN SELECT RAISE(ABORT, 'published catalog SKU price data is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `catalogskupricepackaging_immutable_update`
BEFORE UPDATE ON `catalog_sku_price_packaging`
WHEN EXISTS (SELECT 1 FROM `catalog_releases` WHERE `source_import_id` = OLD.`import_id` AND `status` IN ('published', 'superseded'))
BEGIN SELECT RAISE(ABORT, 'published catalog SKU price data is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `catalogskupricepackaging_immutable_delete`
BEFORE DELETE ON `catalog_sku_price_packaging`
WHEN EXISTS (SELECT 1 FROM `catalog_releases` WHERE `source_import_id` = OLD.`import_id` AND `status` IN ('published', 'superseded'))
BEGIN SELECT RAISE(ABORT, 'published catalog SKU price data is immutable'); END;
--> statement-breakpoint

CREATE TRIGGER `catalogseriescommercialrules_draft_insert_revision` AFTER INSERT ON `catalog_series_commercial_rules`
BEGIN UPDATE `catalog_releases` SET `version` = `version` + 1 WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft'; END;
--> statement-breakpoint
CREATE TRIGGER `catalogseriescommercialrules_draft_update_revision` AFTER UPDATE ON `catalog_series_commercial_rules`
BEGIN UPDATE `catalog_releases` SET `version` = `version` + 1 WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft'; END;
--> statement-breakpoint
CREATE TRIGGER `catalogseriescommercialrules_draft_delete_revision` AFTER DELETE ON `catalog_series_commercial_rules`
BEGIN UPDATE `catalog_releases` SET `version` = `version` + 1 WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft'; END;
--> statement-breakpoint
CREATE TRIGGER `catalogskupricepackaging_draft_insert_revision` AFTER INSERT ON `catalog_sku_price_packaging`
BEGIN UPDATE `catalog_releases` SET `version` = `version` + 1 WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft'; END;
--> statement-breakpoint
CREATE TRIGGER `catalogskupricepackaging_draft_update_revision` AFTER UPDATE ON `catalog_sku_price_packaging`
BEGIN UPDATE `catalog_releases` SET `version` = `version` + 1 WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft'; END;
--> statement-breakpoint
CREATE TRIGGER `catalogskupricepackaging_draft_delete_revision` AFTER DELETE ON `catalog_sku_price_packaging`
BEGIN UPDATE `catalog_releases` SET `version` = `version` + 1 WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft'; END;
--> statement-breakpoint

UPDATE `application_schema_state`
SET `version` = 52, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
