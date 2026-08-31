import type {
  EmailOtpAuthorizationScope,
  EmailOtpPurpose,
} from "../domain/email-otp";
import type { PasswordCredentialHash } from "../domain/customer-password";
import type { PasswordAuthorizationScope } from "../domain/password-authorization";

export interface CustomerProfile {
  email: string;
  id: string;
  verifiedAt: string;
}

export interface OtpChallengeRow {
  authorization_scope: EmailOtpAuthorizationScope;
  consumed_at: string | null;
  created_at: string;
  delivery_status: "delivered" | "pending";
  email_normalized: string;
  expires_at: string;
  failed_attempts: number;
  id: string;
  otp_digest: string;
  purpose: EmailOtpPurpose;
  superseded_at: string | null;
}

export interface PasswordCredentialRow extends PasswordCredentialHash {
  email: string;
  profileId: string;
}

interface PasswordCredentialDatabaseRow {
  algorithm: PasswordCredentialHash["algorithm"];
  derived_key: string;
  email_display: string;
  hash_bytes: 32;
  normalization: "NFC";
  profile_id: string;
  salt: string;
  work_factor: number;
}

const passwordCredentialProjection = `
  SELECT p.id AS profile_id, p.email_display, c.algorithm,
         c.work_factor, c.salt, c.derived_key, c.hash_bytes,
         c.normalization
  FROM customer_profiles p
  INNER JOIN customer_password_credentials c ON c.profile_id = p.id`;

function passwordCredentialFromRow(
  row: PasswordCredentialDatabaseRow | null,
): PasswordCredentialRow | null {
  return row
    ? {
        algorithm: row.algorithm,
        derivedKey: row.derived_key,
        email: row.email_display,
        hashBytes: row.hash_bytes,
        normalization: row.normalization,
        profileId: row.profile_id,
        salt: row.salt,
        workFactor: row.work_factor,
      }
    : null;
}

export class OtpChallengeRequestRejected extends Error {
  constructor(readonly reason: "cooldown" | "rate_limit") {
    super(reason);
  }
}

export class PasswordAttemptRejected extends Error {
  constructor() {
    super("rate_limit");
  }
}

export type PasswordAttemptKind =
  "password_change" | "password_login" | "password_reset";

export function createD1CustomerIdentityRepository(database: D1Database) {
  return {
    async countRecentRequests(input: {
      email: string;
      ipDigest: string;
      since: string;
    }) {
      const [emailResult, ipResult] = await database.batch([
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM customer_otp_challenges
             WHERE email_normalized = ? AND created_at >= ?`,
          )
          .bind(input.email, input.since),
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM customer_otp_challenges
             WHERE request_ip_digest = ? AND created_at >= ?`,
          )
          .bind(input.ipDigest, input.since),
      ]);
      return {
        email: Number(
          (emailResult.results[0] as { count?: number } | undefined)?.count ??
            0,
        ),
        ip: Number(
          (ipResult.results[0] as { count?: number } | undefined)?.count ?? 0,
        ),
      };
    },

    findChallenge(id: string) {
      return database
        .prepare(
          `SELECT id, email_normalized, purpose, authorization_scope,
                  otp_digest, failed_attempts,
                  created_at, expires_at, consumed_at, superseded_at,
                  delivery_status
           FROM customer_otp_challenges WHERE id = ?`,
        )
        .bind(id)
        .first<OtpChallengeRow>();
    },

    async findProfileByEmail(email: string) {
      const row = await database
        .prepare(
          `SELECT id, email_display, email_verified_at
           FROM customer_profiles WHERE email_normalized = ?`,
        )
        .bind(email)
        .first<{
          email_display: string;
          email_verified_at: string;
          id: string;
        }>();
      return row
        ? {
            email: row.email_display,
            id: row.id,
            verifiedAt: row.email_verified_at,
          }
        : null;
    },

    async findProfileBySessionDigest(input: { digest: string; now: string }) {
      const row = await database
        .prepare(
          `SELECT p.id, p.email_display, p.email_verified_at
           FROM customer_sessions s
           INNER JOIN customer_profiles p ON p.id = s.profile_id
           WHERE s.token_digest = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
        )
        .bind(input.digest, input.now)
        .first<{
          email_display: string;
          email_verified_at: string;
          id: string;
        }>();
      return row
        ? {
            email: row.email_display,
            id: row.id,
            verifiedAt: row.email_verified_at,
          }
        : null;
    },

    async latestRequest(email: string) {
      return database
        .prepare(
          `SELECT created_at FROM customer_otp_challenges
           WHERE email_normalized = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(email)
        .first<{ created_at: string }>();
    },

    async createChallenge(input: {
      authorizationScope?: EmailOtpAuthorizationScope;
      createdAt: string;
      digest: string;
      email: string;
      expiresAt: string;
      id: string;
      ipDigest: string;
      purpose: EmailOtpPurpose;
    }) {
      try {
        await database
          .prepare(
            `INSERT INTO customer_otp_challenges
               (id, email_normalized, purpose, authorization_scope,
                otp_digest, request_ip_digest,
                delivery_status, failed_attempts, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
          )
          .bind(
            input.id,
            input.email,
            input.purpose,
            input.authorizationScope ?? "session",
            input.digest,
            input.ipDigest,
            input.createdAt,
            input.expiresAt,
          )
          .run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("CUSTOMER_OTP_COOLDOWN")) {
          throw new OtpChallengeRequestRejected("cooldown");
        }
        if (
          message.includes("CUSTOMER_OTP_EMAIL_RATE_LIMIT") ||
          message.includes("CUSTOMER_OTP_IP_RATE_LIMIT")
        ) {
          throw new OtpChallengeRequestRejected("rate_limit");
        }
        throw error;
      }
    },

    async activateDeliveredChallenge(input: {
      deliveredAt: string;
      email: string;
      id: string;
      purpose: EmailOtpPurpose;
    }) {
      const results = await database.batch([
        database
          .prepare(
            `UPDATE customer_otp_challenges AS target
             SET delivery_status = 'delivered',
                 superseded_at = CASE WHEN EXISTS (
                   SELECT 1 FROM customer_otp_challenges AS newer
                   WHERE newer.email_normalized = target.email_normalized
                     AND newer.purpose = target.purpose
                     AND newer.rowid > target.rowid
                     AND newer.delivery_status = 'delivered'
                 ) THEN ? ELSE NULL END
             WHERE target.id = ? AND target.delivery_status = 'pending'
             RETURNING id`,
          )
          .bind(input.deliveredAt, input.id),
        database
          .prepare(
            `UPDATE customer_otp_challenges AS older SET superseded_at = ?
             WHERE older.email_normalized = ? AND older.purpose = ?
               AND older.delivery_status = 'delivered'
               AND older.consumed_at IS NULL AND older.superseded_at IS NULL
               AND older.rowid < (
                 SELECT target.rowid FROM customer_otp_challenges AS target
                 WHERE target.id = ?
               )
               AND EXISTS (
                 SELECT 1 FROM customer_otp_challenges AS target
                 WHERE target.id = ? AND target.delivery_status = 'delivered'
                   AND target.superseded_at IS NULL
               )`,
          )
          .bind(
            input.deliveredAt,
            input.email,
            input.purpose,
            input.id,
            input.id,
          ),
      ]);
      if ((results[0]?.meta.changes ?? 0) !== 1) {
        throw new Error("OTP challenge delivery could not be activated");
      }
    },

    async discardUndeliveredChallenge(id: string) {
      await database
        .prepare(
          `DELETE FROM customer_otp_challenges
           WHERE id = ? AND delivery_status = 'pending'`,
        )
        .bind(id)
        .run();
    },

    async recordFailedAttempt(id: string) {
      await database
        .prepare(
          `UPDATE customer_otp_challenges
           SET failed_attempts = MIN(failed_attempts + 1, 5)
           WHERE id = ? AND delivery_status = 'delivered'
             AND consumed_at IS NULL AND superseded_at IS NULL`,
        )
        .bind(id)
        .run();
    },

    async completeVerification(input: {
      authenticate: boolean;
      challengeId: string;
      email: string;
      expiresAt: string;
      now: string;
      profileId: string;
      previousTokenDigest: string | null;
      sessionId: string;
      tokenDigest: string;
    }) {
      const nonce = crypto.randomUUID();
      const results = await database.batch([
        database
          .prepare(
            `UPDATE customer_otp_challenges
             SET consumed_at = ?, consumption_nonce = ?
             WHERE id = ? AND consumed_at IS NULL AND superseded_at IS NULL
               AND delivery_status = 'delivered'
               AND failed_attempts < 5 AND expires_at > ?
             RETURNING id`,
          )
          .bind(input.now, nonce, input.challengeId, input.now),
        database
          .prepare(
            `INSERT INTO customer_profiles
             (id, email_normalized, email_display, email_verified_at, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE ? = 1 AND EXISTS (
             SELECT 1 FROM customer_otp_challenges
             WHERE id = ? AND consumption_nonce = ?
           )
           ON CONFLICT(email_normalized) DO UPDATE SET
             email_display = excluded.email_display,
             email_verified_at = excluded.email_verified_at,
             updated_at = excluded.updated_at
           RETURNING id, email_display, email_verified_at`,
          )
          .bind(
            input.profileId,
            input.email,
            input.email,
            input.now,
            input.now,
            input.now,
            input.authenticate ? 1 : 0,
            input.challengeId,
            nonce,
          ),
        database
          .prepare(
            `UPDATE customer_sessions SET revoked_at = ?
             WHERE token_digest = ? AND revoked_at IS NULL AND ? = 1
               AND EXISTS (
                 SELECT 1 FROM customer_otp_challenges
                 WHERE id = ? AND consumption_nonce = ?
               )`,
          )
          .bind(
            input.now,
            input.previousTokenDigest ?? "",
            input.authenticate ? 1 : 0,
            input.challengeId,
            nonce,
          ),
        database
          .prepare(
            `INSERT INTO customer_sessions
             (id, profile_id, token_digest, created_at, expires_at)
           SELECT ?, ?, ?, ?, ?
           WHERE ? = 1 AND EXISTS (
             SELECT 1 FROM customer_otp_challenges
             WHERE id = ? AND consumption_nonce = ?
           ) AND EXISTS (
             SELECT 1 FROM customer_profiles WHERE id = ?
           )`,
          )
          .bind(
            input.sessionId,
            input.profileId,
            input.tokenDigest,
            input.now,
            input.expiresAt,
            input.authenticate ? 1 : 0,
            input.challengeId,
            nonce,
            input.profileId,
          ),
      ]);
      const consumed = (results[0]?.meta.changes ?? 0) === 1;
      if (!consumed) return { consumed: false, profile: null };
      if (!input.authenticate) return { consumed: true, profile: null };
      const profileRow = results[1]?.results[0] as
        | {
            email_display: string;
            email_verified_at: string;
            id: string;
          }
        | undefined;
      if (!profileRow || (results[3]?.meta.changes ?? 0) !== 1) {
        throw new Error("Customer verification transaction was incomplete");
      }
      return {
        consumed: true,
        profile: {
          email: profileRow.email_display,
          id: profileRow.id,
          verifiedAt: profileRow.email_verified_at,
        },
      };
    },

    async revokeSession(tokenDigest: string, revokedAt: string) {
      await database
        .prepare(
          `UPDATE customer_sessions SET revoked_at = ?
           WHERE token_digest = ? AND revoked_at IS NULL`,
        )
        .bind(revokedAt, tokenDigest)
        .run();
    },

    async findPasswordCredentialByEmail(email: string) {
      const row = await database
        .prepare(`${passwordCredentialProjection} WHERE p.email_normalized = ?`)
        .bind(email)
        .first<PasswordCredentialDatabaseRow>();
      return passwordCredentialFromRow(row);
    },

    async findPasswordCredentialByProfileId(profileId: string) {
      const row = await database
        .prepare(`${passwordCredentialProjection} WHERE p.id = ?`)
        .bind(profileId)
        .first<PasswordCredentialDatabaseRow>();
      return passwordCredentialFromRow(row);
    },

    async reservePasswordAttempt(input: {
      attemptKind: PasswordAttemptKind;
      createdAt: string;
      emailDigest: string;
      id: string;
      ipDigest: string;
    }) {
      try {
        await database
          .prepare(
            `INSERT INTO customer_password_attempts
             (id, attempt_kind, email_digest, request_ip_digest, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            input.id,
            input.attemptKind,
            input.emailDigest,
            input.ipDigest,
            input.createdAt,
          )
          .run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("CUSTOMER_PASSWORD_EMAIL_RATE_LIMIT") ||
          message.includes("CUSTOMER_PASSWORD_IP_RATE_LIMIT")
        ) {
          throw new PasswordAttemptRejected();
        }
        throw error;
      }
    },

    async markPasswordAttemptSucceeded(id: string, succeededAt: string) {
      await database
        .prepare(
          `UPDATE customer_password_attempts SET succeeded_at = ? WHERE id = ?`,
        )
        .bind(succeededAt, id)
        .run();
    },

    async createPasswordCredential(input: {
      credential: PasswordCredentialHash;
      now: string;
      profileId: string;
    }) {
      const result = await database
        .prepare(
          `INSERT INTO customer_password_credentials
           (profile_id, algorithm, work_factor, salt, derived_key, hash_bytes,
            normalization, credential_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(profile_id) DO NOTHING
           RETURNING profile_id`,
        )
        .bind(
          input.profileId,
          input.credential.algorithm,
          input.credential.workFactor,
          input.credential.salt,
          input.credential.derivedKey,
          input.credential.hashBytes,
          input.credential.normalization,
          input.now,
          input.now,
        )
        .first<{ profile_id: string }>();
      return Boolean(result);
    },

    async createSessionForProfile(input: {
      expiresAt: string;
      now: string;
      previousTokenDigest: string | null;
      profileId: string;
      sessionId: string;
      tokenDigest: string;
    }) {
      const results = await database.batch([
        database
          .prepare(
            `UPDATE customer_sessions SET revoked_at = ?
             WHERE token_digest = ? AND revoked_at IS NULL`,
          )
          .bind(input.now, input.previousTokenDigest ?? ""),
        database
          .prepare(
            `INSERT INTO customer_sessions
             (id, profile_id, token_digest, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            input.sessionId,
            input.profileId,
            input.tokenDigest,
            input.now,
            input.expiresAt,
          ),
      ]);
      if ((results[1]?.meta.changes ?? 0) !== 1) {
        throw new Error("Customer session could not be created");
      }
    },

    async createPasswordAuthorization(input: {
      authorizationId: string;
      challengeId: string;
      email: string;
      expiresAt: string;
      now: string;
      scope: PasswordAuthorizationScope;
      tokenDigest: string;
    }) {
      const nonce = crypto.randomUUID();
      const results = await database.batch([
        database
          .prepare(
            `UPDATE customer_otp_challenges
             SET consumed_at = ?, consumption_nonce = ?
             WHERE id = ? AND email_normalized = ?
               AND purpose = 'sign_in' AND authorization_scope = ?
               AND consumed_at IS NULL AND superseded_at IS NULL
               AND delivery_status = 'delivered' AND failed_attempts < 5
               AND expires_at > ? RETURNING id`,
          )
          .bind(
            input.now,
            nonce,
            input.challengeId,
            input.email,
            input.scope,
            input.now,
          ),
        database
          .prepare(
            `INSERT INTO customer_password_authorizations
             (id, profile_id, scope, token_digest, created_at, expires_at)
             SELECT ?, p.id, ?, ?, ?, ? FROM customer_profiles p
             WHERE p.email_normalized = ? AND EXISTS (
               SELECT 1 FROM customer_otp_challenges
               WHERE id = ? AND consumption_nonce = ?
             ) RETURNING id, profile_id`,
          )
          .bind(
            input.authorizationId,
            input.scope,
            input.tokenDigest,
            input.now,
            input.expiresAt,
            input.email,
            input.challengeId,
            nonce,
          ),
      ]);
      const row = results[1]?.results[0] as
        { id: string; profile_id: string } | undefined;
      return (results[0]?.meta.changes ?? 0) === 1 && row
        ? { id: row.id, profileId: row.profile_id }
        : null;
    },

    async findPasswordAuthorization(input: {
      now: string;
      tokenDigest: string;
    }) {
      const row = await database
        .prepare(
          `SELECT a.id, a.profile_id, a.scope, p.email_display
           FROM customer_password_authorizations a
           INNER JOIN customer_profiles p ON p.id = a.profile_id
           WHERE a.token_digest = ? AND a.consumed_at IS NULL
             AND a.expires_at > ?`,
        )
        .bind(input.tokenDigest, input.now)
        .first<{
          email_display: string;
          id: string;
          profile_id: string;
          scope: PasswordAuthorizationScope;
        }>();
      return row
        ? {
            email: row.email_display,
            id: row.id,
            profileId: row.profile_id,
            scope: row.scope,
          }
        : null;
    },

    async replacePasswordWithAuthorization(input: {
      authorizationId: string;
      credential: PasswordCredentialHash;
      expiresAt: string;
      now: string;
      profileId: string;
      sessionId: string;
      tokenDigest: string;
    }) {
      const consumptionNonce = crypto.randomUUID();
      const results = await database.batch([
        database
          .prepare(
            `UPDATE customer_password_authorizations
             SET consumed_at = ?, consumption_nonce = ?
             WHERE id = ? AND profile_id = ? AND consumed_at IS NULL
               AND expires_at > ? RETURNING id`,
          )
          .bind(
            input.now,
            consumptionNonce,
            input.authorizationId,
            input.profileId,
            input.now,
          ),
        database
          .prepare(
            `INSERT INTO customer_password_credentials
             (profile_id, algorithm, work_factor, salt, derived_key, hash_bytes,
              normalization, credential_version, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE EXISTS (
               SELECT 1 FROM customer_password_authorizations
               WHERE id = ? AND profile_id = ? AND consumption_nonce = ?
             )
             ON CONFLICT(profile_id) DO UPDATE SET
               algorithm = excluded.algorithm,
               work_factor = excluded.work_factor,
               salt = excluded.salt,
               derived_key = excluded.derived_key,
               hash_bytes = excluded.hash_bytes,
               normalization = excluded.normalization,
               credential_version = customer_password_credentials.credential_version + 1,
               updated_at = excluded.updated_at
             RETURNING profile_id`,
          )
          .bind(
            input.profileId,
            input.credential.algorithm,
            input.credential.workFactor,
            input.credential.salt,
            input.credential.derivedKey,
            input.credential.hashBytes,
            input.credential.normalization,
            input.now,
            input.now,
            input.authorizationId,
            input.profileId,
            consumptionNonce,
          ),
        database
          .prepare(
            `UPDATE customer_sessions SET revoked_at = ?
             WHERE profile_id = ? AND revoked_at IS NULL AND EXISTS (
               SELECT 1 FROM customer_password_authorizations
               WHERE id = ? AND profile_id = ? AND consumption_nonce = ?
             )`,
          )
          .bind(
            input.now,
            input.profileId,
            input.authorizationId,
            input.profileId,
            consumptionNonce,
          ),
        database
          .prepare(
            `INSERT INTO customer_sessions
             (id, profile_id, token_digest, created_at, expires_at)
             SELECT ?, ?, ?, ?, ? WHERE EXISTS (
               SELECT 1 FROM customer_password_authorizations
               WHERE id = ? AND profile_id = ? AND consumption_nonce = ?
             )`,
          )
          .bind(
            input.sessionId,
            input.profileId,
            input.tokenDigest,
            input.now,
            input.expiresAt,
            input.authorizationId,
            input.profileId,
            consumptionNonce,
          ),
      ]);
      return (
        (results[0]?.meta.changes ?? 0) === 1 &&
        (results[1]?.meta.changes ?? 0) === 1 &&
        (results[3]?.meta.changes ?? 0) === 1
      );
    },

    async replacePasswordAndRotateSessions(input: {
      credential: PasswordCredentialHash;
      expiresAt: string;
      now: string;
      profileId: string;
      sessionId: string;
      tokenDigest: string;
    }) {
      const results = await database.batch([
        database
          .prepare(
            `UPDATE customer_password_credentials SET
               algorithm = ?, work_factor = ?, salt = ?, derived_key = ?,
               hash_bytes = ?, normalization = ?,
               credential_version = credential_version + 1, updated_at = ?
             WHERE profile_id = ? RETURNING profile_id`,
          )
          .bind(
            input.credential.algorithm,
            input.credential.workFactor,
            input.credential.salt,
            input.credential.derivedKey,
            input.credential.hashBytes,
            input.credential.normalization,
            input.now,
            input.profileId,
          ),
        database
          .prepare(
            `UPDATE customer_sessions SET revoked_at = ?
             WHERE profile_id = ? AND revoked_at IS NULL`,
          )
          .bind(input.now, input.profileId),
        database
          .prepare(
            `INSERT INTO customer_sessions
             (id, profile_id, token_digest, created_at, expires_at)
             SELECT ?, ?, ?, ?, ? WHERE EXISTS (
               SELECT 1 FROM customer_password_credentials WHERE profile_id = ?
             )`,
          )
          .bind(
            input.sessionId,
            input.profileId,
            input.tokenDigest,
            input.now,
            input.expiresAt,
            input.profileId,
          ),
      ]);
      return (
        (results[0]?.meta.changes ?? 0) === 1 &&
        (results[2]?.meta.changes ?? 0) === 1
      );
    },
  };
}
