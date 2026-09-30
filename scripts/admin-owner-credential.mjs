// Cloudflare Workers accepts at most 100,000 PBKDF2 iterations; keep in sync with
// customerPasswordWorkFactor in app/modules/customer-identity/domain/customer-password.ts.
const workFactor = 100_000;

/** @param {Uint8Array} bytes */
function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * Same policy as the admin password forms: 8-128 characters with an uppercase
 * letter, a lowercase letter and a number.
 * @param {string} password
 * @returns {string} the NFC-normalized password
 */
export function validatedOwnerPassword(password) {
  const normalized = password.normalize("NFC");
  const length = Array.from(normalized).length;
  if (length < 8) throw new Error("Use at least 8 characters.");
  if (length > 128) throw new Error("Use no more than 128 characters.");
  if (
    !/\p{Lu}/u.test(normalized) ||
    !/\p{Ll}/u.test(normalized) ||
    !/\p{Nd}/u.test(normalized)
  ) {
    throw new Error(
      "Include an uppercase letter, a lowercase letter and a number.",
    );
  }
  return normalized;
}

/**
 * Builds the JSON credential the Worker stores in admin_identities.password_hash
 * (PBKDF2-HMAC-SHA-256, 100,000 iterations, 16-byte random salt).
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function ownerPasswordHash(password) {
  const normalized = validatedOwnerPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalized),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { hash: "SHA-256", iterations: workFactor, name: "PBKDF2", salt },
      key,
      256,
    ),
  );
  return JSON.stringify({
    algorithm: "PBKDF2-HMAC-SHA-256",
    derivedKey: encodeBase64Url(derived),
    hashBytes: 32,
    normalization: "NFC",
    salt: encodeBase64Url(salt),
    workFactor,
  });
}

/** @param {string} value */
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

/**
 * SQL that gives the existing Owner the username `admin` and the new password,
 * or creates the Owner when none exists. Bumping credential_version signs out
 * every existing admin session of that account.
 * @param {string} passwordHash
 * @param {string} now ISO timestamp
 * @param {boolean} ownerExists
 * @returns {string}
 */
export function ownerCredentialSql(passwordHash, now, ownerExists) {
  return ownerExists
    ? `UPDATE admin_identities SET username = 'admin', display_name = CASE WHEN display_name = '' THEN 'Owner' ELSE display_name END, password_hash = ${literal(passwordHash)}, credential_version = credential_version + 1, updated_at = ${literal(now)} WHERE account_type = 'owner' AND deleted_at IS NULL`
    : `INSERT INTO admin_identities (id, email, username, display_name, password_hash, account_type, status, can_manage_subaccounts, created_at, updated_at) VALUES ('owner-1', 'owner@admin.invalid', 'admin', 'Owner', ${literal(passwordHash)}, 'owner', 'active', 1, ${literal(now)}, ${literal(now)})`;
}
