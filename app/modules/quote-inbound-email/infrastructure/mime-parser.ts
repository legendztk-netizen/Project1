import PostalMime, { addressParser } from "postal-mime";
import { convert } from "html-to-text";
import { validateConversationAttachment } from "../../quote-conversation/domain/conversation-attachment";
import {
  InboundRejection,
  MAX_INBOUND_HEADERS_BYTES,
  normalizedEmail,
} from "../domain/inbound-email";

export async function parseInboundMime(
  raw: Uint8Array,
  authenticatedSender: string,
) {
  // Bound candidate MIME boundary lines before allocating parser nodes. The MIME
  // library still owns all boundary/encoding parsing; excess markers fail closed.
  let markers = 0;
  for (let offset = 0; offset < raw.length - 1; offset++) {
    if (
      (offset === 0 || raw[offset - 1] === 10) &&
      raw[offset] === 45 &&
      raw[offset + 1] === 45 &&
      ++markers > 128
    )
      throw new InboundRejection("malformed_mime");
  }
  let parsed;
  try {
    parsed = await PostalMime.parse(raw, {
      maxNestingDepth: 10,
      maxHeadersSize: MAX_INBOUND_HEADERS_BYTES,
      forceRfc822Attachments: true,
      rfc822Attachments: true,
      attachmentEncoding: "arraybuffer",
    });
  } catch {
    throw new InboundRejection("malformed_mime");
  }
  const headers = (key: string) =>
    parsed.headers.filter((header) => header.key === key);
  const from = headers("from");
  const mailboxes = from.length === 1 ? addressParser(from[0].value) : [];
  if (
    mailboxes.length !== 1 ||
    !mailboxes[0].address ||
    normalizedEmail(mailboxes[0].address) !== authenticatedSender
  )
    throw new InboundRejection("sender_mismatch");
  const sender = headers("sender");
  if (
    sender.length > 1 ||
    (sender.length &&
      normalizedEmail(parsed.sender?.address ?? "") !== authenticatedSender)
  )
    throw new InboundRejection("sender_mismatch");
  if (
    headers("auto-submitted").some(
      (header) => header.value.trim().toLowerCase() !== "no",
    ) ||
    parsed.headers.some((header) => header.key.startsWith("resent-"))
  )
    throw new InboundRejection("automated_message");
  if (
    headers("message-id").length > 1 ||
    (parsed.messageId && !/^<[^<>\s]{1,500}>$/.test(parsed.messageId))
  )
    throw new InboundRejection("malformed_mime");
  if (parsed.attachments.length > 1)
    throw new InboundRejection("too_many_attachments");
  if (parsed.html && parsed.html.length > 65536)
    throw new InboundRejection("body_out_of_bounds");
  const limitMarker = "[inbound-email-limit]";
  const plain =
    parsed.text ??
    (parsed.html
      ? convert(parsed.html, {
          wordwrap: false,
          limits: {
            maxInputLength: 65536,
            maxDepth: 32,
            maxChildNodes: 2048,
            ellipsis: limitMarker,
          },
          selectors: [
            { selector: "img", format: "skip" },
            { selector: "a", options: { ignoreHref: true } },
          ],
        })
      : "");
  const body = plain.replaceAll("\r\n", "\n").trim();
  if (body.includes(limitMarker))
    throw new InboundRejection("body_out_of_bounds");
  if (body.length > 10000 || (!body && !parsed.attachments.length))
    throw new InboundRejection("body_out_of_bounds");
  let attachment: Awaited<
    ReturnType<typeof validateConversationAttachment>
  > | null = null;
  if (parsed.attachments[0]) {
    const file = parsed.attachments[0];
    if (!file.filename || typeof file.content === "string")
      throw new InboundRejection("attachment_rejected");
    try {
      const bytes = new Uint8Array(file.content);
      attachment = await validateConversationAttachment(
        new File([bytes], file.filename, { type: file.mimeType }),
      );
    } catch {
      throw new InboundRejection("attachment_rejected");
    }
  }
  return { body, messageId: parsed.messageId ?? null, attachment };
}
