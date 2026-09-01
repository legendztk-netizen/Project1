import type { ApplicationBindings } from "#workers/environment";

import { createCustomerIdentityService } from "./customer-identity-service";
import {
  parseSavedConfigurationSnapshot,
  type SavedConfiguration,
} from "../domain/saved-configuration";
import { createD1SavedConfigurationRepository } from "../infrastructure/d1-saved-configuration-repository";
import type { SavedConfigurationRow } from "../infrastructure/d1-saved-configuration-repository";

function savedConfiguration(row: SavedConfigurationRow): SavedConfiguration {
  return {
    createdAt: row.created_at,
    id: row.id,
    snapshot: parseSavedConfigurationSnapshot(row.snapshot_json),
    source: row.source_kind,
    updatedAt: row.updated_at,
  };
}

export function createSavedConfigurationService(
  env: ApplicationBindings,
  options: { now?: () => Date } = {},
) {
  const identity = createCustomerIdentityService(env);
  const repository = createD1SavedConfigurationRepository(env.DB);
  const now = options.now ?? (() => new Date());

  async function owner(request: Request) {
    return identity.readSession(request);
  }

  return {
    async create(input: {
      commandId: string;
      request: Request;
      snapshotJson: string;
    }) {
      const profile = await owner(input.request);
      if (!profile) return null;
      parseSavedConfigurationSnapshot(input.snapshotJson);
      const id = crypto.randomUUID();
      const savedId = await repository.createExplicit({
        commandId: input.commandId,
        id,
        now: now().toISOString(),
        profileId: profile.id,
        snapshotJson: input.snapshotJson,
      });
      return savedId ? { id: savedId } : null;
    },

    async delete(input: { id: string; request: Request }) {
      const profile = await owner(input.request);
      if (!profile) return null;
      return repository.deleteOwned({ id: input.id, profileId: profile.id });
    },

    async find(input: { id: string; request: Request }) {
      const profile = await owner(input.request);
      if (!profile) return null;
      const row = await repository.findOwned({
        id: input.id,
        profileId: profile.id,
      });
      return row ? savedConfiguration(row) : null;
    },

    async list(request: Request) {
      const profile = await owner(request);
      if (!profile) return null;
      const rows = await repository.listOwned(profile.id);
      return rows.map(savedConfiguration);
    },
  };
}
