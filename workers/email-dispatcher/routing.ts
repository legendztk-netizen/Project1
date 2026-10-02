// Kept out of index.ts: a Worker entry module may export only handlers and
// entrypoint classes.
import type { InboundEmailReceiver } from "../inbound-email-rpc";

export interface EmailDispatcherBindings {
  PREVIEW_REPLY_DOMAIN: string;
  PRODUCTION_REPLY_DOMAIN: string;
  PREVIEW_INBOUND_EMAIL: InboundEmailReceiver;
  PRODUCTION_INBOUND_EMAIL: InboundEmailReceiver;
}

export const UNROUTED_RECIPIENT_REASON =
  "This address does not accept email. Reply using the address in your quote email or the website quote conversation.";

export function receiverFor(recipient: string, env: EmailDispatcherBindings) {
  const domain = recipient.slice(recipient.lastIndexOf("@") + 1).toLowerCase();
  if (domain === env.PRODUCTION_REPLY_DOMAIN)
    return env.PRODUCTION_INBOUND_EMAIL;
  if (domain === env.PREVIEW_REPLY_DOMAIN) return env.PREVIEW_INBOUND_EMAIL;
  return null;
}
