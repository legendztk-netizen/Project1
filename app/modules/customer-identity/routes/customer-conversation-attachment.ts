import type { Route } from "./+types/customer-conversation-attachment";
import { cloudflareContext } from "#workers/context";
import { customerConversationContext } from "../infrastructure/customer-conversation-context";
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return (await customerConversationContext(env, request)).download(
    params.requestId,
    params.messageId,
  );
}
