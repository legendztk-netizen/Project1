import { createHash, randomBytes } from "node:crypto";

// Each smoke suite uses an isolated migrated database. Exercise the real
// session boundary without depending on a developer's password or database.
export function adminSmokeSession() {
  const token = randomBytes(32).toString("hex");
  const digest = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 3600000).toISOString();
  return {
    cookie: `hs_admin_session=${token}`,
    sql: `INSERT INTO admin_identities(id,email,username,display_name,account_type,status,created_at,updated_at) VALUES('local-owner','owner@local.invalid','admin','Smoke Owner','owner','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO admin_password_sessions(token_hash,admin_id,credential_version,expires_at) VALUES('${digest}','local-owner',1,'${expires}');`,
    fetch(input: string | URL, init?: RequestInit) {
      const url = new URL(input);
      const headers = new Headers(init?.headers);
      headers.set("Connection", "close");
      if (/^\/admin(?:\/|\.data|$)/.test(url.pathname)) {
        headers.set(
          "Cookie",
          [headers.get("Cookie"), `hs_admin_session=${token}`]
            .filter(Boolean)
            .join("; "),
        );
        if (
          !["GET", "HEAD"].includes((init?.method ?? "GET").toUpperCase()) &&
          !headers.has("Origin")
        )
          headers.set("Origin", url.origin);
      }
      return globalThis.fetch(input, { ...init, headers });
    },
  };
}
