CREATE TABLE `catalog_adapter_families` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`adapter_family_id` text NOT NULL,
	`sku_template` text NOT NULL,
	`catalog_model` text NOT NULL,
	`website_product_name` text NOT NULL,
	`shape_code` text NOT NULL,
	`interface_1` text NOT NULL,
	`connection_form_1` text NOT NULL,
	`size_1` text,
	`interface_2` text NOT NULL,
	`connection_form_2` text NOT NULL,
	`size_2` text,
	`interface_3` text,
	`connection_form_3` text,
	`size_3` text,
	`website_display` text NOT NULL,
	`source` text NOT NULL,
	`notes` text,
	`catalog_publication_status` text NOT NULL,
	`rfq_eligibility` text NOT NULL,
	`technical_data_status` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `catalog_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_adapter_families_import_family_uq` ON `catalog_adapter_families` (`import_id`,`adapter_family_id`);--> statement-breakpoint
CREATE TABLE `catalog_adapters` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`sku` text NOT NULL,
	`adapter_family_id` text NOT NULL,
	`sku_template` text NOT NULL,
	`catalog_model` text NOT NULL,
	`website_product_name` text NOT NULL,
	`shape_code` text NOT NULL,
	`interface_1` text NOT NULL,
	`connection_form_1` text NOT NULL,
	`size_1` text NOT NULL,
	`interface_2` text NOT NULL,
	`connection_form_2` text NOT NULL,
	`size_2` text NOT NULL,
	`interface_3` text,
	`connection_form_3` text,
	`size_3` text,
	`website_display` text NOT NULL,
	`source` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`import_id`,`sku`) REFERENCES `catalog_skus`(`import_id`,`sku`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_adapters_import_sku_uq` ON `catalog_adapters` (`import_id`,`sku`);--> statement-breakpoint
CREATE INDEX `catalog_adapters_interfaces_idx` ON `catalog_adapters` (`import_id`,`interface_1`,`interface_2`,`size_1`,`size_2`);--> statement-breakpoint
CREATE TABLE `catalog_cost_bases` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`sales_sku` text NOT NULL,
	`currency` text,
	`factory_unit_price` real,
	`price_incoterm` text,
	`incoterm_place` text,
	`tier_qty` real,
	`tier_price` real,
	FOREIGN KEY (`import_id`,`sales_sku`) REFERENCES `catalog_sales_offers`(`import_id`,`sales_sku`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_cost_bases_import_sales_sku_uq` ON `catalog_cost_bases` (`import_id`,`sales_sku`);--> statement-breakpoint
CREATE TABLE `catalog_quick_couplers` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`sku` text NOT NULL,
	`sku_standard_code` text NOT NULL,
	`sku_role_code` text NOT NULL,
	`body_dash` text NOT NULL,
	`port_code` text NOT NULL,
	`port_dash` text NOT NULL,
	`coupler_series` text NOT NULL,
	`role` text NOT NULL,
	`mating_series` text NOT NULL,
	`interchange_standard` text NOT NULL,
	`body_size` text NOT NULL,
	`port_interface` text NOT NULL,
	`port_gender` text NOT NULL,
	`port_thread` text NOT NULL,
	`connection_mechanism` text NOT NULL,
	`valving` text NOT NULL,
	`body_material` text,
	`coating` text,
	`seal_material` text,
	`max_working_bar` real,
	`minimum_burst_bar` real,
	`rated_flow_l_min` real,
	`pressure_drop_basis` text,
	`temp_min_c` real,
	`temp_max_c` real,
	`overall_length_mm` real,
	`unit_weight_g` real,
	`drawing_number` text,
	`source` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`import_id`,`sku`) REFERENCES `catalog_skus`(`import_id`,`sku`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_quick_couplers_import_sku_uq` ON `catalog_quick_couplers` (`import_id`,`sku`);--> statement-breakpoint
CREATE INDEX `catalog_quick_couplers_identity_idx` ON `catalog_quick_couplers` (`import_id`,`interchange_standard`,`role`,`body_dash`,`port_code`,`port_dash`);--> statement-breakpoint
CREATE TABLE `catalog_sales_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`base_sku` text NOT NULL,
	`sales_sku` text NOT NULL,
	`product_type` text NOT NULL,
	`sales_unit` text NOT NULL,
	`package_length_ft` real,
	`units_per_sales_pack` real NOT NULL,
	`moq` real NOT NULL,
	`net_unit_weight_kg` real,
	`lead_time_days` real NOT NULL,
	`country_of_origin` text NOT NULL,
	`currency` text,
	`reference_price_usd` real,
	`inner_pack_qty` real,
	`master_carton_qty` real,
	`carton_gross_weight_kg` real,
	`carton_l_cm` real,
	`carton_w_cm` real,
	`carton_h_cm` real,
	`packing_basis` text,
	`hs_code` text,
	`notes` text,
	`catalog_publication_status` text NOT NULL,
	`rfq_eligibility` text NOT NULL,
	`technical_data_status` text NOT NULL,
	`quantity_input_mode` text NOT NULL,
	`minimum_length_per_piece_ft` real,
	`length_increment_ft` real,
	`preset_length_1_ft` real,
	`preset_length_2_ft` real,
	`preset_length_3_ft` real,
	`continuous_length_confirmation` text,
	FOREIGN KEY (`import_id`,`base_sku`) REFERENCES `catalog_skus`(`import_id`,`sku`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_sales_offers_import_base_sku_uq` ON `catalog_sales_offers` (`import_id`,`base_sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_sales_offers_import_sales_sku_uq` ON `catalog_sales_offers` (`import_id`,`sales_sku`);--> statement-breakpoint
CREATE INDEX `catalog_sales_offers_public_price_idx` ON `catalog_sales_offers` (`import_id`,`reference_price_usd`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 5, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
