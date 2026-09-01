import type { ApplicationBindings } from "#workers/environment";

import {
  CustomerAccountValidationError,
  type DeliveryAddressDraft,
  type OrganizationDraft,
  validatedDeliveryAddress,
  validatedOrganization,
} from "../domain/customer-account";
import { createD1CustomerAccountRepository } from "../infrastructure/d1-customer-account-repository";
import { createCustomerProfileService } from "./customer-profile-service";

export { CustomerAccountValidationError };

export class CustomerAccountAccessError extends Error {}

export function createCustomerAccountService(
  env: ApplicationBindings,
  options: { now?: () => Date } = {},
) {
  const profiles = createCustomerProfileService(env);
  const repository = createD1CustomerAccountRepository(env.DB);
  const now = options.now ?? (() => new Date());

  async function authenticatedProfile(request: Request) {
    return profiles.read(request);
  }

  async function ensureAccount(profileId: string) {
    await repository.ensureIndividualContext({
      contextId: crypto.randomUUID(),
      now: now().toISOString(),
      profileId,
    });
  }

  async function requiredProfile(request: Request) {
    const profile = await authenticatedProfile(request);
    if (!profile) return null;
    await ensureAccount(profile.id);
    return profile;
  }

  return {
    async read(request: Request) {
      const profile = await requiredProfile(request);
      if (!profile) return null;
      const [addresses, purchasingContexts] = await Promise.all([
        repository.listDeliveryAddresses(profile.id),
        repository.listPurchasingContexts(profile.id),
      ]);
      return { addresses, profile, purchasingContexts };
    },

    async createAddress(input: DeliveryAddressDraft & { request: Request }) {
      const profile = await requiredProfile(input.request);
      if (!profile) return null;
      const address = validatedDeliveryAddress(input);
      const created = await repository.createDeliveryAddress({
        ...address,
        id: crypto.randomUUID(),
        now: now().toISOString(),
        profileId: profile.id,
      });
      if (!created) throw new CustomerAccountAccessError();
      return true;
    },

    async updateAddress(
      input: DeliveryAddressDraft & {
        addressId: string;
        request: Request;
      },
    ) {
      const profile = await requiredProfile(input.request);
      if (!profile) return null;
      const address = validatedDeliveryAddress(input);
      const updated = await repository.updateDeliveryAddress({
        ...address,
        id: input.addressId,
        now: now().toISOString(),
        profileId: profile.id,
      });
      if (!updated) throw new CustomerAccountAccessError();
      return true;
    },

    async selectAddress(input: { addressId: string; request: Request }) {
      const profile = await requiredProfile(input.request);
      if (!profile) return null;
      const selected = await repository.selectDeliveryAddress({
        addressId: input.addressId,
        now: now().toISOString(),
        profileId: profile.id,
      });
      if (!selected) throw new CustomerAccountAccessError();
      return true;
    },

    async deleteAddress(input: { addressId: string; request: Request }) {
      const profile = await requiredProfile(input.request);
      if (!profile) return null;
      const deleted = await repository.deleteDeliveryAddress({
        addressId: input.addressId,
        profileId: profile.id,
      });
      if (!deleted) throw new CustomerAccountAccessError();
      return true;
    },

    async createOrganization(input: OrganizationDraft & { request: Request }) {
      const profile = await requiredProfile(input.request);
      if (!profile) return null;
      const organization = validatedOrganization(input);
      const created = await repository.createOrganizationContext({
        ...organization,
        contextId: crypto.randomUUID(),
        membershipId: crypto.randomUUID(),
        now: now().toISOString(),
        organizationId: crypto.randomUUID(),
        profileId: profile.id,
      });
      if (!created) throw new CustomerAccountAccessError();
      return true;
    },

    async selectPurchasingContext(input: {
      contextId: string;
      request: Request;
    }) {
      const profile = await requiredProfile(input.request);
      if (!profile) return null;
      const selected = await repository.selectPurchasingContext({
        contextId: input.contextId,
        now: now().toISOString(),
        profileId: profile.id,
      });
      if (!selected) throw new CustomerAccountAccessError();
      return true;
    },
  };
}
