ALTER TABLE admin_identities ADD COLUMN username TEXT;
ALTER TABLE admin_identities ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_identities ADD COLUMN password_hash TEXT;
ALTER TABLE admin_identities ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE admin_identities ADD COLUMN deleted_at TEXT;
CREATE UNIQUE INDEX admin_username_unique ON admin_identities(username COLLATE NOCASE);
CREATE TABLE admin_module_permissions (
 admin_id TEXT NOT NULL REFERENCES admin_identities(id),
 module TEXT NOT NULL CHECK(module IN ('catalog','quotes','orders','after_sales','messages','notifications','settings')),
 level TEXT NOT NULL CHECK(level IN ('read','write')),
 PRIMARY KEY(admin_id,module)
);
CREATE TABLE admin_password_sessions (
 token_hash TEXT PRIMARY KEY,
 admin_id TEXT NOT NULL REFERENCES admin_identities(id),
 credential_version INTEGER NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX admin_password_session_account ON admin_password_sessions(admin_id);
CREATE TABLE admin_login_limits (
 key TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 expires_at TEXT NOT NULL
);
UPDATE application_schema_state SET version=130,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
