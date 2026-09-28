import { redirect } from "react-router";
import type { ApplicationBindings } from "#workers/environment";
import { createCustomerIdentityService } from "../application/customer-identity-service";
import { createQuoteConversationService } from "../../quote-conversation/application/quote-conversation-service";
import { createMessageCenter } from "../../message-center/application/message-center-service";

export async function customerConversationContext(
  env: ApplicationBindings,
  request: Request,
) {
  const identity =
    await createCustomerIdentityService(env).readSession(request);
  if (!identity)
    throw redirect(
      `/sign-in?returnTo=${encodeURIComponent(new URL(request.url).pathname)}`,
    );
  return createQuoteConversationService(env.DB, env.PRIVATE_FILES, {
    kind: "customer",
    profileId: identity.id,
  });
}

export async function customerMessageCenter(
  env: ApplicationBindings,
  request: Request,
) {
  const identity =
    await createCustomerIdentityService(env).readSession(request);
  if (!identity)
    throw redirect(
      `/sign-in?returnTo=${encodeURIComponent(new URL(request.url).pathname)}`,
    );
  return createMessageCenter(env.DB, env.PRIVATE_FILES).customer(identity.id);
}
