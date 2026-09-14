import {
  digest,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { validateConversationAttachment } from "../domain/conversation-attachment";
import {
  conversationAuthor,
  conversationInput,
  type QuoteConversationActor,
} from "../domain/quote-conversation";
import {
  createD1QuoteConversationRepository,
  type ConversationReservation,
} from "../infrastructure/d1-quote-conversation";

export type { QuoteConversationActor } from "../domain/quote-conversation";
export type {
  ConversationMessage,
  ConversationAttachment,
} from "../domain/quote-conversation";

export function createQuoteConversationService(
  database: D1Database,
  bucket: R2Bucket,
  actor: QuoteConversationActor | null | undefined,
) {
  const author = conversationAuthor(actor);
  const repository = createD1QuoteConversationRepository(database);

  async function retire(reservation: ConversationReservation) {
    if (reservation.byte_size) {
      // Keep the empty marker: deleting it would let a delayed conditional PUT
      // recreate abandoned file bytes after their budget has been released.
      await bucket.put(`quote-conversation/${reservation.id}`, "", {
        customMetadata: { state: "abandoned" },
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "private, no-store",
        },
      });
    }
    await repository.release(reservation.id);
  }

  async function reconcileExpired(requestId: string) {
    await repository.requireQuote(requestId, author);
    let released = 0;
    let legacy = 0;
    for (const reservation of await repository.expiredReservations(
      requestId,
      author,
    )) {
      if (await repository.releaseCommittedReservation(reservation.id)) {
        released++;
        continue;
      }
      // Pre-fix uploads used unrelated random keys that cannot be recovered
      // from these rows. Never free their storage budget without an inventory.
      if (reservation.byte_size && !reservation.id.startsWith("r1-")) {
        legacy++;
        continue;
      }
      const abandoned = await repository.abandon(reservation.id, true);
      if (abandoned) {
        await retire(abandoned);
        released++;
      }
    }
    return { released, legacy };
  }

  return {
    reconcileExpired,
    async list(requestId: string, options: { before?: string } = {}) {
      await repository.requireQuote(requestId, author);
      return {
        id: requestId,
        requestId,
        ...(await repository.list(requestId, author, options.before)),
      };
    },

    async send(input: {
      request: Request;
      requestId: string;
      commandId: string;
      body: string;
      attachment?: File | null;
    }) {
      requireReviewMutation(input.request);
      await repository.requireQuote(input.requestId, author);
      const normalized = conversationInput({
        body: input.body,
        commandId: input.commandId,
        hasAttachment: !!input.attachment,
      });
      const file = input.attachment
        ? await validateConversationAttachment(input.attachment)
        : null;
      const payloadHash = await digest(
        new TextEncoder().encode(
          JSON.stringify([
            input.requestId,
            author.role,
            author.id,
            normalized.body,
            file
              ? [
                  file.filename,
                  file.contentType,
                  file.bytes.byteLength,
                  file.checksum,
                ]
              : null,
          ]),
        ).buffer,
      );

      function replay(row: Awaited<ReturnType<typeof repository.findCommand>>) {
        if (!row) return null;
        if (
          row.request_id !== input.requestId ||
          row.author_role !== author.role ||
          row.author_id !== author.id ||
          row.payload_hash !== payloadHash
        )
          throw new Response("Command conflict", { status: 409 });
        return repository.message(input.requestId, row.id, author);
      }
      const existing = replay(
        await repository.findCommand(normalized.commandId),
      );
      if (existing) return existing;

      await reconcileExpired(input.requestId);
      const id = `r1-${crypto.randomUUID()}`;
      const attachment = file
        ? {
            filename: file.filename,
            contentType: file.contentType,
            byteSize: file.bytes.byteLength,
            checksum: file.checksum,
            objectKey: `quote-conversation/${id}`,
          }
        : null;
      const createdAt = new Date().toISOString();
      await repository.reserve({
        id,
        requestId: input.requestId,
        author,
        createdAt,
        attachment,
      });
      try {
        if (attachment && file) {
          const stored = await bucket.put(attachment.objectKey, file.bytes, {
            httpMetadata: { contentType: file.contentType },
            onlyIf: { etagDoesNotMatch: "*" },
          });
          if (!stored)
            throw new Response(
              "Upload reservation expired; retry the command",
              { status: 409 },
            );
        }
        await repository.append({
          id,
          requestId: input.requestId,
          author,
          commandId: normalized.commandId,
          payloadHash,
          body: normalized.body,
          createdAt,
          attachment,
        });
      } catch (error) {
        const abandoned = await repository.abandon(id, false);
        if (abandoned) await retire(abandoned);
        const completed = await repository.findCommand(normalized.commandId);
        const result = replay(completed);
        if (result) return result;
        await repository.requireQuote(input.requestId, author);
        if (
          error instanceof Error &&
          error.message.includes(
            "NOT NULL constraint failed: quote_conversation_messages.author_id",
          )
        )
          throw new Response("Upload reservation expired; retry the command", {
            status: 409,
          });
        throw error;
      }
      return repository.message(input.requestId, id, author);
    },

    async download(requestId: string, messageId: string) {
      await repository.requireQuote(requestId, author);
      const file = await repository.findAttachment(
        requestId,
        messageId,
        author,
      );
      if (!file) throw new Response("Not found", { status: 404 });
      const object = await bucket.get(file.object_key);
      if (!object) throw new Response("Not found", { status: 404 });
      if (object.size !== file.byte_size)
        throw new Response("Attachment integrity failure", { status: 409 });
      const bytes = await object.arrayBuffer();
      if ((await digest(bytes)) !== file.checksum)
        throw new Response("Attachment integrity failure", { status: 409 });
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${file.filename}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox",
          "Referrer-Policy": "no-referrer",
        },
      });
    },
  };
}
