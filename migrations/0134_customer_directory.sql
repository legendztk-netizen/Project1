-- Registration and last sign-in network location shown in the Admin Customer
-- Directory (ADR 0059). Registration fields are written once, when the profile
-- is created; last sign-in fields are replaced on every new session.
CREATE TABLE customer_access_records (
 profile_id TEXT PRIMARY KEY NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
 registration_ip TEXT,
 registration_country TEXT,
 registration_region TEXT,
 registration_city TEXT,
 last_sign_in_at TEXT,
 last_sign_in_method TEXT CHECK(last_sign_in_method IS NULL OR last_sign_in_method IN ('email_code','password','password_reset')),
 last_sign_in_ip TEXT,
 last_sign_in_country TEXT,
 last_sign_in_region TEXT,
 last_sign_in_city TEXT
);
--> statement-breakpoint
-- Sessions created before this migration give the last sign-in time; their IP
-- address was only kept as a keyed digest and cannot be recovered.
INSERT INTO customer_access_records(profile_id,last_sign_in_at)
SELECT profile_id,max(created_at) FROM customer_sessions GROUP BY profile_id;
--> statement-breakpoint
CREATE INDEX customer_profiles_created ON customer_profiles(created_at DESC,id DESC);
--> statement-breakpoint
-- Organization RFQs are found by purchasing context, not by the submitting profile.
CREATE INDEX customer_quote_requests_context_submitted ON customer_quote_requests(purchasing_context_id,submitted_at DESC);
--> statement-breakpoint
-- Keep existing grants; the Customer Directory requires its own explicit grant.
CREATE TABLE admin_module_permissions_next (
 admin_id TEXT NOT NULL REFERENCES admin_identities(id),
 module TEXT NOT NULL CHECK(module IN ('catalog','configurator','quotes','orders','after_sales','messages','notifications','settings','customers')),
 level TEXT NOT NULL CHECK(level IN ('read','write')),
 PRIMARY KEY(admin_id,module)
);
--> statement-breakpoint
INSERT INTO admin_module_permissions_next SELECT * FROM admin_module_permissions;
--> statement-breakpoint
DROP TABLE admin_module_permissions;
--> statement-breakpoint
ALTER TABLE admin_module_permissions_next RENAME TO admin_module_permissions;
--> statement-breakpoint
UPDATE application_schema_state SET version=135,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
