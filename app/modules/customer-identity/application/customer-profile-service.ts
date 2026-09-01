import type { ApplicationBindings } from "#workers/environment";

import { createCustomerIdentityService } from "./customer-identity-service";
import {
  CustomerProfileValidationError,
  validatedCustomerContact,
} from "../domain/customer-profile";
import { createD1CustomerIdentityRepository } from "../infrastructure/d1-customer-identity-repository";

export { CustomerProfileValidationError };

export function createCustomerProfileService(env: ApplicationBindings) {
  const identity = createCustomerIdentityService(env);
  const repository = createD1CustomerIdentityRepository(env.DB);

  async function authenticatedProfile(request: Request) {
    const session = await identity.readSession(request);
    if (!session) return null;
    const profile = await repository.findCustomerProfileById(session.id);
    if (!profile) return null;
    return {
      ...profile,
      savedConfigurationCount: await repository.countSavedConfigurations(
        profile.id,
      ),
    };
  }

  return {
    read: authenticatedProfile,

    async updateContact(input: {
      fullName: string;
      phoneNumber: string;
      request: Request;
    }) {
      const profile = await authenticatedProfile(input.request);
      if (!profile) return null;
      const contact = validatedCustomerContact(input);
      await repository.updateCustomerProfileContact({
        ...contact,
        profileId: profile.id,
        updatedAt: new Date().toISOString(),
      });
      return authenticatedProfile(input.request);
    },
  };
}
