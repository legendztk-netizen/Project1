CREATE TABLE `admin_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_events_entity_idx` ON `admin_audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `admin_audit_events_occurred_at_idx` ON `admin_audit_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `application_schema_state` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`source_file_name` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT "catalog_import_kind" CHECK("catalog_imports"."kind" in ('diagnostic', 'workbook')),
	CONSTRAINT "catalog_import_status" CHECK("catalog_imports"."status" in ('pending', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `catalog_imports_created_at_idx` ON `catalog_imports` (`created_at`);--> statement-breakpoint
CREATE TABLE `catalog_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`release_number` text NOT NULL,
	`status` text NOT NULL,
	`source_import_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`source_import_id`) REFERENCES `catalog_imports`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "catalog_release_status" CHECK("catalog_releases"."status" in ('draft', 'published', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_releases_release_number_uq` ON `catalog_releases` (`release_number`);--> statement-breakpoint
CREATE INDEX `catalog_releases_status_created_at_idx` ON `catalog_releases` (`status`,`created_at`);
--> statement-breakpoint
INSERT INTO `application_schema_state` (`singleton`, `version`, `updated_at`)
VALUES (1, 1, CURRENT_TIMESTAMP);
