CREATE TABLE `catalog_compatibilities` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`compatibility_id` text NOT NULL,
	`hose_sku` text NOT NULL,
	`hose_end_sku` text NOT NULL,
	`ferrule_sku` text NOT NULL,
	`assembly_method` text,
	`skive_requirement` text,
	`outer_skive_length_mm` real,
	`inner_skive_length_mm` real,
	`insertion_depth_mm` real,
	`crimp_program` text,
	`final_crimp_diameter_mm` real,
	`tolerance_mm` real,
	`measurement_location` text,
	`assembly_working_bar` real,
	`proof_pressure_bar` real,
	`proof_hold_seconds` real,
	`qualification_id` text,
	`qualification_status` text NOT NULL,
	`rfq_eligibility` text NOT NULL,
	`reference_system` text,
	`reference_hose_code` text,
	`reference_assembly_method` text,
	`reference_crimp_diameter_mm` real,
	`reference_tolerance_mm` real,
	`reference_source` text,
	`notes` text,
	`technical_data_status` text NOT NULL,
	`production_approval_status` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `catalog_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`,`hose_sku`) REFERENCES `catalog_skus`(`import_id`,`sku`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`,`hose_end_sku`) REFERENCES `catalog_skus`(`import_id`,`sku`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`,`ferrule_sku`) REFERENCES `catalog_skus`(`import_id`,`sku`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_compatibility_production_approval" CHECK("catalog_compatibilities"."production_approval_status" in ('approved', 'not_approved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_compatibilities_import_id_uq` ON `catalog_compatibilities` (`import_id`,`compatibility_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_compatibilities_exact_tuple_uq` ON `catalog_compatibilities` (`import_id`,`hose_sku`,`hose_end_sku`,`ferrule_sku`);--> statement-breakpoint
CREATE INDEX `catalog_compatibilities_import_status_idx` ON `catalog_compatibilities` (`import_id`,`rfq_eligibility`,`qualification_status`);--> statement-breakpoint
CREATE TABLE `catalog_ferrules` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`sku` text NOT NULL,
	`ferrule_series` text NOT NULL,
	`hose_construction` text NOT NULL,
	`hose_tail_dash` text NOT NULL,
	`skive_requirement` text NOT NULL,
	`material` text NOT NULL,
	`coating` text NOT NULL,
	`source` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`import_id`,`sku`) REFERENCES `catalog_skus`(`import_id`,`sku`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_ferrules_import_sku_uq` ON `catalog_ferrules` (`import_id`,`sku`);--> statement-breakpoint
CREATE INDEX `catalog_ferrules_series_dash_idx` ON `catalog_ferrules` (`import_id`,`ferrule_series`,`hose_tail_dash`);--> statement-breakpoint
CREATE TABLE `catalog_hose_ends` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`sku` text NOT NULL,
	`fitting_series` text NOT NULL,
	`competitor_part_number` text,
	`interface_family` text NOT NULL,
	`connection_standard` text NOT NULL,
	`gender` text NOT NULL,
	`swivel_form` text NOT NULL,
	`angle` text NOT NULL,
	`sealing_form` text NOT NULL,
	`thread` text NOT NULL,
	`connection_dash` text NOT NULL,
	`hose_tail_dash` text NOT NULL,
	`material` text,
	`coating` text,
	`salt_spray_hours` real,
	`max_working_bar` real,
	`dimension_a_mm` real,
	`cutoff_b_mm` real,
	`hex_1_mm` real,
	`hex_2_mm` real,
	`minimum_bore_mm` real,
	`unit_weight_g` real,
	`drawing_number` text,
	`drawing_revision` text,
	`source` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`import_id`,`sku`) REFERENCES `catalog_skus`(`import_id`,`sku`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_hose_ends_import_sku_uq` ON `catalog_hose_ends` (`import_id`,`sku`);--> statement-breakpoint
CREATE INDEX `catalog_hose_ends_interface_idx` ON `catalog_hose_ends` (`import_id`,`interface_family`,`connection_dash`,`hose_tail_dash`);--> statement-breakpoint
CREATE TABLE `catalog_hose_series` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`series_code` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `catalog_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_hose_series_import_code_uq` ON `catalog_hose_series` (`import_id`,`series_code`);--> statement-breakpoint
CREATE TABLE `catalog_hose_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`sku` text NOT NULL,
	`hose_series` text NOT NULL,
	`primary_standard` text NOT NULL,
	`equivalent_standard` text,
	`dash` text NOT NULL,
	`nominal_id_in` real NOT NULL,
	`id_mm` real NOT NULL,
	`od_mm` real NOT NULL,
	`working_bar` real NOT NULL,
	`working_psi` real,
	`burst_bar` real NOT NULL,
	`bend_radius_mm` real NOT NULL,
	`weight_kg_m` real NOT NULL,
	`temp_min_c` real NOT NULL,
	`temp_max_c` real NOT NULL,
	`tube_material` text NOT NULL,
	`reinforcement` text NOT NULL,
	`cover_material` text NOT NULL,
	`cover_color` text NOT NULL,
	`cover_finish` text,
	`skive_requirement` text NOT NULL,
	`msha_marking` text,
	`fluid_compatibility` text NOT NULL,
	`origin` text NOT NULL,
	`source` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`import_id`,`sku`) REFERENCES `catalog_skus`(`import_id`,`sku`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_hose_variants_import_sku_uq` ON `catalog_hose_variants` (`import_id`,`sku`);--> statement-breakpoint
CREATE INDEX `catalog_hose_variants_series_dash_idx` ON `catalog_hose_variants` (`import_id`,`hose_series`,`dash`);--> statement-breakpoint
CREATE TABLE `catalog_import_validation_results` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`worksheet` text NOT NULL,
	`row_number` integer NOT NULL,
	`field_name` text NOT NULL,
	`stable_sku` text,
	`severity` text NOT NULL,
	`code` text NOT NULL,
	`message` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `catalog_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_import_validation_severity" CHECK("catalog_import_validation_results"."severity" in ('error', 'warning'))
);
--> statement-breakpoint
CREATE INDEX `catalog_import_validation_import_idx` ON `catalog_import_validation_results` (`import_id`,`row_number`);--> statement-breakpoint
CREATE TABLE `catalog_skus` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`sku` text NOT NULL,
	`source_worksheet` text NOT NULL,
	`product_type` text NOT NULL,
	`hose_series` text,
	`catalog_publication_status` text NOT NULL,
	`rfq_eligibility` text NOT NULL,
	`technical_data_status` text NOT NULL,
	`supply_availability` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `catalog_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_sku_product_type" CHECK("catalog_skus"."product_type" in ('hose', 'hose_end', 'ferrule', 'adapter', 'quick_coupler')),
	CONSTRAINT "catalog_sku_supply_availability" CHECK("catalog_skus"."supply_availability" in ('available_for_quote', 'temporarily_unavailable', 'discontinued'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_skus_import_sku_uq` ON `catalog_skus` (`import_id`,`sku`);--> statement-breakpoint
CREATE INDEX `catalog_skus_import_type_idx` ON `catalog_skus` (`import_id`,`product_type`);--> statement-breakpoint
CREATE INDEX `catalog_skus_import_series_idx` ON `catalog_skus` (`import_id`,`hose_series`);--> statement-breakpoint
ALTER TABLE `catalog_imports` ADD `source_file_size_bytes` integer;--> statement-breakpoint
ALTER TABLE `catalog_imports` ADD `summary_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_imports` ADD `error_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_imports` ADD `warning_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 3, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
