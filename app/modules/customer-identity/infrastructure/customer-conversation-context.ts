import { redirect } from "react-router";
import type { ApplicationBindings } from "#workers/environment";
import { createCustomerIdentityService } from "../application/customer-identity-service";
import { createQuoteConversationService } from "../../quote-conversation/application/quote-conversation-service";

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
