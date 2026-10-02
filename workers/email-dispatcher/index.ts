// Account-wide Email Worker for the customhoseco.com zone. Email Routing has a
// single catch-all rule per zone, so it points here and each environment's
// reply domain is relayed to that environment's application Worker.
import { INBOUND_EMAIL_RETRY_REASON } from "../inbound-email-rpc";
import {
  type EmailDispatcherBindings,
  UNROUTED_RECIPIENT_REASON,
  receiverFor,
} from "./routing";

export default {
  async email(message, env) {
    const receiver = receiverFor(message.to, env);
    if (!receiver) {
      message.setReject(UNROUTED_RECIPIENT_REASON);
      return;
    }
    try {
      const outcome = await receiver.receive(
        {
          from: message.from,
          to: message.to,
          rawSize: message.rawSize,
          headers: [...message.headers],
        },
        message.raw,
      );
      if (!outcome.accepted) message.setReject(outcome.reason);
    } catch {
      // The target Worker is missing, not yet deployed with the entrypoint, or
      // failed before answering. Never accept a reply that was not received.
      message.setReject(INBOUND_EMAIL_RETRY_REASON);
    }
  },
} satisfies ExportedHandler<EmailDispatcherBindings>;
