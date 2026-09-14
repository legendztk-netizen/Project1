import type { AdminIdentity } from "#workers/admin-access";

// These identities must come from server authentication, never from form fields.
export type QuoteConversationActor =
  | { kind: "customer"; profileId: string }
  | { kind: "admin"; identity: AdminIdentity };

export interface ConversationAuthor {
  role: "customer" | "admin";
  id: string;
}

export interface ConversationAttachment {
  filename: string;
  contentType: string;
  byteSize: number;
  checksum: string;
}

export interface ConversationMessage {
  id: string;
  authorRole: ConversationAuthor["role"];
  body: string;
  createdAt: string;
  source: "website";
  // Available in the website conversation; not an email delivery receipt.
  deliveryState: "available";
  attachment: ConversationAttachment | null;
}

export function conversationAuthor(
  actor: QuoteConversationActor | null | undefined,
): ConversationAuthor {
  if (
    actor?.kind === "customer" &&
    typeof actor.profileId === "string" &&
    actor.profileId.trim()
  )
    return { role: "customer", id: actor.profileId };
  if (
    actor?.kind === "admin" &&
    actor.identity?.id &&
    ["owner", "subaccount"].includes(actor.identity.accountType)
  )
    return { role: "admin", id: actor.identity.id };
  throw new Response("Conversation access denied", { status: 403 });
}

export function conversationInput(input: {
  body: string;
  commandId: string;
  hasAttachment: boolean;
}) {
  if (
    typeof input.commandId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.commandId,
    )
  )
    throw new Response("Command id required", { status: 400 });
  if (
    typeof input.body !== "string" ||
    input.body.length > 10000 ||
    (!input.body.trim() && !input.hasAttachment)
  )
    throw new Response("Message must contain text or a permitted file", {
      status: 400,
    });
  return { body: input.body.trim(), commandId: input.commandId.toLowerCase() };
}
