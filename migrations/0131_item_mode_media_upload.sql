-- Item-level publication (Spec 11) must keep accepting new product images after the cutover is committed:
-- an image replacement creates a new media version (Spec 11 section 13). Only INSERT into the two media tables is
-- reopened. The cutover freeze still blocks uploads while it is frozen, UPDATE and DELETE stay closed, published
-- media versions stay immutable, and every other legacy catalog table remains write-protected.
DROP TRIGGER cutover_guard_catalog_media_lineages_insert;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_media_lineages_insert BEFORE INSERT ON catalog_media_lineages
WHEN (SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
DROP TRIGGER cutover_guard_catalog_media_versions_insert;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_media_versions_insert BEFORE INSERT ON catalog_media_versions
WHEN (SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=132,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
