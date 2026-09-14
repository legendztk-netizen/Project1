import type { Route } from "./+types/quote-conversation-attachment";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createQuoteConversationService } from "../../quote-conversation/application/quote-conversation-service";
export async function loader({ context, params }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  return createQuoteConversationService(env.DB, env.PRIVATE_FILES, {
    kind: "admin",
    identity: adminIdentity,
  }).download(params.requestId, params.messageId);
}
