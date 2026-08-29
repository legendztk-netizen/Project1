import {
  normalizePendingConfigurationEmail,
  pendingConfigurationSaveIdentity,
  pendingConfigurationRateLimitKey,
  pendingConfigurationVerificationToken,
  pendingConfigurationVerificationTokenHash,
  preparePendingConfigurationSnapshot,
  PendingConfigurationSaveRejected,
} from "../domain/pending-configuration-save";
import { createD1PendingConfigurationRepository } from "../infrastructure/d1-pending-configuration-repository";
import type { ApplicationBindings } from "#workers/environment";
import { quoteSessionSigningKey } from "#workers/session-secrets";

export interface PendingConfigurationEmailMessage {
  effectId: string;
  email: string;
  pendingConfigurationId: string;
  token: string;
  type: "pending_configuration_verification";
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function createPendingConfigurationSaveService(
  env: ApplicationBindings,
  dependencies: {
    generateId?: () => string;
    now?: () => Date;
    repository?: ReturnType<typeof createD1PendingConfigurationRepository>;
  } = {},
) {
  const repository =
    dependencies.repository ?? createD1PendingConfigurationRepository(env.DB);
  const generateId = dependencies.generateId ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date());
  const verificationSecret = quoteSessionSigningKey(env);

  return {
    async save(input: {
      configuration: unknown;
      email: unknown;
      pageState: unknown;
      requestAddress?: string | null;
    }) {
      const email = normalizePendingConfigurationEmail(input.email);
      const { snapshot, versions } = preparePendingConfigurationSnapshot(input);
      const saveIdentity = await pendingConfigurationSaveIdentity(
        email,
        snapshot,
      );
      const current = now();
      const createdAt = current.toISOString();
      const existing = await repository.hasActiveSave(saveIdentity, createdAt);
      const rateWindow = current.toISOString().slice(0, 13);
      const emailRateKey = await pendingConfigurationRateLimitKey(
        `email:${email}:${rateWindow}`,
      );
      const emailAllowed = existing
        ? true
        : await repository.consumeSaveLimit({
            key: emailRateKey,
            limit: 5,
            windowExpiresAt: addHours(current, 1),
          });
      const address = input.requestAddress?.trim();
      const addressAllowed =
        address && !existing
          ? await repository.consumeSaveLimit({
              key: await pendingConfigurationRateLimitKey(
                `address:${address}:${rateWindow}`,
              ),
              limit: 20,
              windowExpiresAt: addHours(current, 1),
            })
          : true;
      if (!emailAllowed || !addressAllowed) {
        throw new PendingConfigurationSaveRejected(
          "Too many save attempts were made. Keep this page open and try again later.",
          "RATE_LIMITED",
        );
      }
      const token = await pendingConfigurationVerificationToken(
        saveIdentity,
        verificationSecret,
      );
      const tokenHash = await pendingConfigurationVerificationTokenHash(token);
      const saved = await repository.save({
        catalogReleaseId: snapshot.configuration.catalogRelease.id,
        createdAt,
        effectId: generateId(),
        email,
        expiresAt: addDays(current, 30),
        id: generateId(),
        saveIdentity,
        snapshot,
        tokenHash,
        verificationExpiresAt: addHours(current, 24),
        versions,
      });
      if (!saved) {
        throw new PendingConfigurationSaveRejected(
          "The catalog changed while this configuration was being saved. Keep this page open and try again.",
          "INVALID_DRAFT",
        );
      }

      const claimed = await repository.claimEmailDispatch({
        effectId: saved.effectId,
        now: createdAt,
        retryBefore: new Date(current.getTime() - 15 * 60 * 1000).toISOString(),
      });
      if (claimed) {
        try {
          await env.ASYNC_JOBS.send({
            effectId: saved.effectId,
            email: saved.email,
            pendingConfigurationId: saved.id,
            token,
            type: "pending_configuration_verification",
          } satisfies PendingConfigurationEmailMessage);
          await repository.markEmailEffectQueued(saved.effectId, createdAt);
        } catch {
          await repository.releaseEmailEffect(saved.effectId, createdAt);
          throw new PendingConfigurationSaveRejected(
            "Your configuration is still open, but the verification email could not be started. Try again.",
            "EMAIL_UNAVAILABLE",
          );
        }
      }

      return {
        alreadySaved: !saved.created,
        email: saved.email,
        id: saved.id,
      };
    },

    async verify(token: string) {
      if (!/^[A-Za-z0-9_-]{40,100}$/u.test(token)) return null;
      const tokenHash = await pendingConfigurationVerificationTokenHash(token);
      return repository.verifyEmail(tokenHash, now().toISOString());
    },
  };
}
