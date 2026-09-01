import type { SavedConfigurationSource } from "../domain/saved-configuration";

export interface SavedConfigurationRow {
  created_at: string;
  id: string;
  snapshot_json: string;
  source_kind: SavedConfigurationSource;
  updated_at: string;
}

export function createD1SavedConfigurationRepository(database: D1Database) {
  return {
    async createExplicit(input: {
      commandId: string;
      id: string;
      now: string;
      profileId: string;
      snapshotJson: string;
    }) {
      const result = await database
        .prepare(
          `INSERT INTO customer_saved_configurations
             (id, profile_id, source_kind, source_registration_transaction_id, command_id,
              snapshot_json, created_at, updated_at)
           SELECT ?, id, 'explicit', NULL, ?, ?, ?, ?
           FROM customer_profiles WHERE id = ?
           ON CONFLICT(profile_id, command_id) WHERE command_id IS NOT NULL
           DO NOTHING`,
        )
        .bind(
          input.id,
          input.commandId,
          input.snapshotJson,
          input.now,
          input.now,
          input.profileId,
        )
        .run();
      if ((result.meta.changes ?? 0) > 1) return null;
      const saved = await database
        .prepare(
          `SELECT id FROM customer_saved_configurations
           WHERE profile_id = ? AND command_id = ? AND source_kind = 'explicit'`,
        )
        .bind(input.profileId, input.commandId)
        .first<{ id: string }>();
      return saved?.id ?? null;
    },

    async deleteOwned(input: { id: string; profileId: string }) {
      const result = await database
        .prepare(
          `DELETE FROM customer_saved_configurations
           WHERE id = ? AND profile_id = ?`,
        )
        .bind(input.id, input.profileId)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async findOwned(input: { id: string; profileId: string }) {
      return database
        .prepare(
          `SELECT id, source_kind, snapshot_json, created_at, updated_at
           FROM customer_saved_configurations
           WHERE id = ? AND profile_id = ?`,
        )
        .bind(input.id, input.profileId)
        .first<SavedConfigurationRow>();
    },

    async listOwned(profileId: string) {
      const rows = await database
        .prepare(
          `SELECT id, source_kind, snapshot_json, created_at, updated_at
           FROM customer_saved_configurations
           WHERE profile_id = ?
           ORDER BY updated_at DESC, id`,
        )
        .bind(profileId)
        .all<SavedConfigurationRow>();
      return rows.results;
    },
  };
}
