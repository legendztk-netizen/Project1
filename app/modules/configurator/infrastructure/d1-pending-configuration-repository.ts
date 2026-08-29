import type {
  PendingConfigurationSnapshot,
  PendingConfigurationVersionSnapshot,
} from "../domain/pending-configuration-save";

export type PendingEmailEffectStatus =
  "pending" | "dispatching" | "queued" | "sent";

export interface PendingConfigurationSaveRecord {
  created: boolean;
  effectId: string;
  effectStatus: PendingEmailEffectStatus;
  email: string;
  id: string;
}

interface SavedRow {
  effect_id: string;
  effect_status: PendingEmailEffectStatus;
  email: string;
  id: string;
}

export function createD1PendingConfigurationRepository(database: D1Database) {
  return {
    async claimEmailDelivery(effectId: string, now: string) {
      return database
        .prepare(
          `UPDATE pending_configuration_email_effects
           SET status = 'dispatching', updated_at = ?
           WHERE id = ? AND status = 'queued'
           RETURNING id`,
        )
        .bind(now, effectId)
        .first<{ id: string }>();
    },

    async claimEmailDispatch(input: {
      effectId: string;
      now: string;
      retryBefore: string;
    }) {
      return database
        .prepare(
          `UPDATE pending_configuration_email_effects
           SET status = 'dispatching', updated_at = ?
           WHERE id = ?
             AND (
               status = 'pending'
               OR (status IN ('dispatching', 'queued') AND updated_at <= ?)
             )
           RETURNING id`,
        )
        .bind(input.now, input.effectId, input.retryBefore)
        .first<{ id: string }>();
    },

    async consumeSaveLimit(input: {
      key: string;
      limit: number;
      windowExpiresAt: string;
    }) {
      const row = await database
        .prepare(
          `INSERT INTO pending_configuration_save_limits (
             scope_key, attempt_count, window_expires_at
           ) VALUES (?, 1, ?)
           ON CONFLICT (scope_key) DO UPDATE SET
             attempt_count = attempt_count + 1
           RETURNING attempt_count`,
        )
        .bind(input.key, input.windowExpiresAt)
        .first<{ attempt_count: number }>();
      return Boolean(row && row.attempt_count <= input.limit);
    },

    async hasActiveSave(saveIdentity: string, now: string) {
      const row = await database
        .prepare(
          `SELECT 1 AS found FROM pending_configuration_drafts
           WHERE save_identity = ? AND expires_at > ?`,
        )
        .bind(saveIdentity, now)
        .first<{ found: number }>();
      return Boolean(row);
    },

    async deleteExpired(now: string) {
      const drafts = await database
        .prepare(
          "DELETE FROM pending_configuration_drafts WHERE expires_at <= ?",
        )
        .bind(now)
        .run();
      await database
        .prepare(
          "DELETE FROM pending_configuration_save_limits WHERE window_expires_at <= ?",
        )
        .bind(now)
        .run();
      return drafts.meta.changes;
    },

    async findEmailEffect(effectId: string) {
      return database
        .prepare(
          `SELECT e.id, e.status, d.email, d.id AS pending_configuration_id
           FROM pending_configuration_email_effects e
           INNER JOIN pending_configuration_drafts d
             ON d.id = e.pending_configuration_id
           WHERE e.id = ?`,
        )
        .bind(effectId)
        .first<{
          email: string;
          id: string;
          pending_configuration_id: string;
          status: PendingEmailEffectStatus;
        }>();
    },

    async markEmailEffectQueued(effectId: string, now: string) {
      await database
        .prepare(
          `UPDATE pending_configuration_email_effects
           SET status = 'queued', updated_at = ?
           WHERE id = ? AND status = 'dispatching'`,
        )
        .bind(now, effectId)
        .run();
    },

    async markEmailEffectSent(effectId: string, now: string) {
      await database
        .prepare(
          `UPDATE pending_configuration_email_effects
           SET status = 'sent', sent_at = ?, updated_at = ?
           WHERE id = ? AND status = 'dispatching'`,
        )
        .bind(now, now, effectId)
        .run();
    },

    async releaseEmailEffect(effectId: string, now: string) {
      await database
        .prepare(
          `UPDATE pending_configuration_email_effects
           SET status = 'pending', updated_at = ?
           WHERE id = ? AND status = 'dispatching'`,
        )
        .bind(now, effectId)
        .run();
    },

    async releaseEmailDelivery(effectId: string, now: string) {
      await database
        .prepare(
          `UPDATE pending_configuration_email_effects
           SET status = 'queued', updated_at = ?
           WHERE id = ? AND status = 'dispatching'`,
        )
        .bind(now, effectId)
        .run();
    },

    async save(input: {
      catalogReleaseId: string;
      createdAt: string;
      effectId: string;
      email: string;
      expiresAt: string;
      id: string;
      saveIdentity: string;
      snapshot: PendingConfigurationSnapshot;
      tokenHash: string;
      verificationExpiresAt: string;
      versions: PendingConfigurationVersionSnapshot;
    }): Promise<PendingConfigurationSaveRecord | null> {
      await database
        .prepare(
          `DELETE FROM pending_configuration_drafts
           WHERE save_identity = ? AND expires_at <= ?`,
        )
        .bind(input.saveIdentity, input.createdAt)
        .run();

      const release = await database
        .prepare(
          `SELECT source_import_id
           FROM catalog_releases
           WHERE id = ? AND release_number = ?`,
        )
        .bind(
          input.catalogReleaseId,
          input.snapshot.configuration.catalogRelease.number,
        )
        .first<{ source_import_id: string }>();
      if (!release) return null;
      const references = [
        {
          compatibilityId: null,
          ferruleSku: null,
          hoseEndSku: null,
          hoseSku: input.snapshot.configuration.hose.sku,
        },
        ...[
          input.snapshot.configuration.endA,
          input.snapshot.configuration.endB,
        ]
          .filter((end) => Boolean(end))
          .map((end) => ({
            compatibilityId: end!.compatibilityId,
            ferruleSku: end!.ferrule.sku,
            hoseEndSku: end!.hoseEnd.sku,
            hoseSku: input.snapshot.configuration.hose.sku,
          })),
      ];
      const hoseExists = await database
        .prepare(
          `SELECT 1 AS found FROM catalog_skus
           WHERE import_id = ? AND sku = ? AND product_type = 'hose'`,
        )
        .bind(release.source_import_id, references[0].hoseSku)
        .first<{ found: number }>();
      if (!hoseExists) return null;
      for (const reference of references.slice(1)) {
        const compatible = await database
          .prepare(
            `SELECT 1 AS found FROM catalog_compatibilities
             WHERE import_id = ? AND compatibility_id = ?
               AND hose_sku = ? AND hose_end_sku = ? AND ferrule_sku = ?`,
          )
          .bind(
            release.source_import_id,
            reference.compatibilityId,
            reference.hoseSku,
            reference.hoseEndSku,
            reference.ferruleSku,
          )
          .first<{ found: number }>();
        if (!compatible) return null;
      }

      const insert = await database
        .prepare(
          `INSERT OR IGNORE INTO pending_configuration_drafts (
             id, save_identity, email, catalog_release_id, snapshot_json,
             version_snapshot_json, status, verification_token_hash,
             verification_expires_at, expires_at, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, 'pending_verification', ?, ?, ?, ?, ?)
           RETURNING id`,
        )
        .bind(
          input.id,
          input.saveIdentity,
          input.email,
          input.catalogReleaseId,
          JSON.stringify(input.snapshot),
          JSON.stringify(input.versions),
          input.tokenHash,
          input.verificationExpiresAt,
          input.expiresAt,
          input.createdAt,
          input.createdAt,
        )
        .first<{ id: string }>();

      const pendingId =
        insert?.id ??
        (
          await database
            .prepare(
              `SELECT id FROM pending_configuration_drafts
               WHERE save_identity = ?`,
            )
            .bind(input.saveIdentity)
            .first<{ id: string }>()
        )?.id;
      if (!pendingId) return null;

      if (!insert) {
        const renewed = await database
          .prepare(
            `UPDATE pending_configuration_drafts
             SET verification_token_hash = ?, verification_expires_at = ?,
                 expires_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending_verification'
               AND verification_expires_at <= ?
             RETURNING id`,
          )
          .bind(
            input.tokenHash,
            input.verificationExpiresAt,
            input.expiresAt,
            input.createdAt,
            pendingId,
            input.createdAt,
          )
          .first<{ id: string }>();
        if (renewed) {
          await database
            .prepare(
              `UPDATE pending_configuration_email_effects
               SET status = 'pending', sent_at = NULL, updated_at = ?
               WHERE pending_configuration_id = ?`,
            )
            .bind(input.createdAt, pendingId)
            .run();
        }
      }

      await database
        .prepare(
          `INSERT OR IGNORE INTO pending_configuration_email_effects (
             id, pending_configuration_id, status, created_at, updated_at
           ) VALUES (?, ?, 'pending', ?, ?)`,
        )
        .bind(input.effectId, pendingId, input.createdAt, input.createdAt)
        .run();
      const saved = await database
        .prepare(
          `SELECT d.id, d.email, e.id AS effect_id, e.status AS effect_status
           FROM pending_configuration_drafts d
           INNER JOIN pending_configuration_email_effects e
             ON e.pending_configuration_id = d.id
           WHERE d.id = ?`,
        )
        .bind(pendingId)
        .first<SavedRow>();
      if (!saved) return null;
      return {
        created: Boolean(insert),
        effectId: saved.effect_id,
        effectStatus: saved.effect_status,
        email: saved.email,
        id: saved.id,
      };
    },

    async verifyEmail(tokenHash: string, now: string) {
      return database
        .prepare(
          `UPDATE pending_configuration_drafts
           SET status = 'verified', verified_at = ?, updated_at = ?
           WHERE verification_token_hash = ?
             AND status = 'pending_verification'
             AND verification_expires_at > ?
             AND expires_at > ?
           RETURNING id, email`,
        )
        .bind(now, now, tokenHash, now, now)
        .first<{ email: string; id: string }>();
    },
  };
}
