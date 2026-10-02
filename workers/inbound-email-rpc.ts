// Contract between the account-wide email dispatcher Worker and each
// environment's application Worker. The envelope comes from Cloudflare Email
// Routing via the dispatcher; it is trusted because the `InboundEmail`
// entrypoint is reachable only through same-account service bindings.

export interface InboundEmailEnvelope {
  from: string;
  to: string;
  rawSize: number;
  headers: Array<[string, string]>;
}

export type InboundEmailOutcome =
  { accepted: true } | { accepted: false; reason: string };

export interface InboundEmailReceiver {
  receive(
    envelope: InboundEmailEnvelope,
    raw: ReadableStream<Uint8Array>,
  ): Promise<InboundEmailOutcome>;
}

export const INBOUND_EMAIL_RETRY_REASON =
  "We could not confirm receipt of this reply. Please resend later or use the website quote conversation.";
