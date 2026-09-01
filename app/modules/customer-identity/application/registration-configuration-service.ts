import type { ApplicationBindings } from "#workers/environment";

import {
  parseRegistrationConfigurationSnapshot,
  RegistrationConfigurationRejected,
  registrationConfigurationLifetimeSeconds,
} from "../../configurator/domain/registration-configuration";
import { createCustomerIdentityService } from "./customer-identity-service";
import { createD1RegistrationConfigurationRepository } from "../infrastructure/d1-registration-configuration-repository";

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

export function createRegistrationConfigurationService(
  env: ApplicationBindings,
  options: { now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date());
  const repository = createD1RegistrationConfigurationRepository(env.DB);
  const identity = createCustomerIdentityService(env);

  return {
    async abandon(input: { challengeId: string; transactionId: string }) {
      if (!input.challengeId || !input.transactionId) return false;
      return repository.abandon(input);
    },

    cleanupExpired() {
      return repository.cleanupExpired(now().toISOString());
    },

    async start(input: {
      email: string;
      request: Request;
      snapshotJson: string;
    }) {
      if (await identity.readSession(input.request)) {
        throw new RegistrationConfigurationRejected(
          "This registration path is only available to guests.",
        );
      }
      parseRegistrationConfigurationSnapshot(input.snapshotJson);
      const instant = now();
      await repository.cleanupExpired(instant.toISOString());
      const challenge = await identity.requestOtp({
        email: input.email,
        purpose: "register",
        request: input.request,
      });
      const transactionId = crypto.randomUUID();
      try {
        await repository.create({
          challengeId: challenge.challengeId,
          createdAt: instant.toISOString(),
          expiresAt: addSeconds(
            instant,
            registrationConfigurationLifetimeSeconds,
          ),
          id: transactionId,
          snapshotJson: input.snapshotJson,
        });
      } catch (error) {
        await repository.discardChallenge(challenge.challengeId);
        throw error;
      }
      return { ...challenge, registrationTransactionId: transactionId };
    },
  };
}
