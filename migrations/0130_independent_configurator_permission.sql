-- Keep existing grants; configuring assemblies now requires its own explicit grant.
CREATE TABLE admin_module_permissions_next (
 admin_id TEXT NOT NULL REFERENCES admin_identities(id),
 module TEXT NOT NULL CHECK(module IN ('catalog','configurator','quotes','orders','after_sales','messages','notifications','settings')),
 level TEXT NOT NULL CHECK(level IN ('read','write')),
 PRIMARY KEY(admin_id,module)
);
INSERT INTO admin_module_permissions_next SELECT * FROM admin_module_permissions;
DROP TABLE admin_module_permissions;
ALTER TABLE admin_module_permissions_next RENAME TO admin_module_permissions;
UPDATE application_schema_state SET version=131,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
