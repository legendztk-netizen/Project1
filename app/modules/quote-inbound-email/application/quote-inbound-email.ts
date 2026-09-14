import type { AdminIdentity } from "#workers/admin-access";
import { createD1QuoteConversationRepository } from "../../quote-conversation/infrastructure/d1-quote-conversation";
import {
  boundedRaw,
  inboundBackoff,
  inboundJob,
  InboundRejection,
  MAX_INBOUND_ATTEMPTS,
  normalizedEmail,
  replyToken,
  sha256,
  type InboundEmailMessage,
  type InboundEnvironment,
  type InboundProtector,
  type InboundQueue,
  type InboundQueueMessage,
  type PlatformEmailVerifier,
  type ReplyTokenResolver,
  type InboundReason,
  type InboundAdminQuery,
} from "../domain/inbound-email";
import {
  createD1InboundEmail,
  quoteInboundAppendStatements,
  type InboundReceipt,
} from "../infrastructure/d1-inbound-email";
import { parseInboundMime } from "../infrastructure/mime-parser";

interface ProtectedEnvelope {
  sender: string;
  token: string;
  requestId: string;
  profileId: string;
  rawChecksum: string;
  provider: "cloudflare-email" | "local-fixture";
}

function boundedLimit(limit: number) {
  return Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 50;
}
function active(row: InboundReceipt) {
  return ["staging", "pending", "processing", "retry"].includes(row.state);
}

export function createQuoteInboundEmail(input: {
  database: D1Database;
  bucket: R2Bucket;
  env: InboundEnvironment;
  protector: InboundProtector;
  resolveReplyToken: ReplyTokenResolver;
  verifyPlatformEmail?: PlatformEmailVerifier;
  now?: () => number;
}) {
  const { database, bucket, env, protector } = input;
  const now = input.now ?? Date.now;
  const repository = createD1InboundEmail(database);
  const conversation = createD1QuoteConversationRepository(database);
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/i.test(
      env.EMAIL_REPLY_DOMAIN,
    ) ||
    (env.APP_ENV !== "local" &&
      /\.invalid$|replace-with-/i.test(env.EMAIL_REPLY_DOMAIN))
  )
    throw new Error("Inbound email reply domain is not configured");

  async function immutablePut(
    key: string,
    bytes: Uint8Array,
    checksum: string,
    contentType: string,
  ) {
    const object = await bucket.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType, cacheControl: "private, no-store" },
      customMetadata: { checksum },
    });
    if (!object) {
      const existing = await bucket.get(key);
      if (
        !existing ||
        existing.size !== bytes.byteLength ||
        (await sha256(new Uint8Array(await existing.arrayBuffer()))) !==
          checksum
      )
        throw new InboundRejection("storage_integrity");
    }
  }

  async function retireReservation(receiptId: string) {
    const reservation = await conversation.abandon(`r1-${receiptId}`, false);
    if (!reservation) return;
    if (reservation.byte_size)
      await bucket.put(`quote-conversation/${reservation.id}`, "", {
        customMetadata: { state: "abandoned" },
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "private, no-store",
        },
      });
    await conversation.release(reservation.id);
  }

  async function terminal(
    row: InboundReceipt,
    state: "quarantined" | "duplicate" | "dead_letter",
    reason: InboundReason | null,
    messageId: string | null = null,
  ) {
    await repository.finish(row, state, reason, now(), messageId);
    const saved = await repository.read(row.id);
    if (saved && !active(saved)) await cleanup(saved);
  }

  async function cleanup(row: InboundReceipt) {
    if (!row.cleanup_pending) return true;
    if (row.cleanup_next_at > now()) return false;
    try {
      await retireReservation(row.id);
      await repository.cleaned(row.id);
      return true;
    } catch {
      await repository.cleanupFailed(row.id, now());
      return false;
    }
  }

  async function process(row: InboundReceipt) {
    if (!row.raw_key || !row.protected_envelope)
      throw new InboundRejection("storage_integrity");
    let envelope: ProtectedEnvelope;
    try {
      envelope = JSON.parse(
        await protector.open(row.protected_envelope, `inbound:${row.id}`),
      ) as ProtectedEnvelope;
    } catch {
      throw new InboundRejection("storage_integrity");
    }
    if (
      envelope.rawChecksum !== row.raw_checksum ||
      (env.APP_ENV !== "local" && envelope.provider !== "cloudflare-email")
    )
      throw new InboundRejection("authentication_unverified");
    const scope = await input.resolveReplyToken(
      envelope.token,
      envelope.sender,
    );
    if (
      !scope ||
      scope.requestId !== envelope.requestId ||
      scope.profileId !== envelope.profileId
    )
      throw new InboundRejection("reply_not_authorized");
    const raw = await bucket.get(row.raw_key);
    if (!raw) throw new Error("Inbound storage temporarily unavailable");
    if (raw.size !== row.raw_size)
      throw new InboundRejection("storage_integrity");
    const bytes = new Uint8Array(await raw.arrayBuffer());
    if ((await sha256(bytes)) !== row.raw_checksum)
      throw new InboundRejection("storage_integrity");
    const parsed = await parseInboundMime(bytes, envelope.sender);
    const contentHash = await sha256(
      JSON.stringify([
        parsed.body,
        parsed.attachment
          ? [
              parsed.attachment.filename,
              parsed.attachment.contentType,
              parsed.attachment.checksum,
            ]
          : null,
      ]),
    );
    const contentKey = await sha256(
      JSON.stringify([
        scope.requestId,
        scope.profileId,
        parsed.messageId ?? `content:${contentHash}`,
      ]),
    );
    const duplicate = await repository.content(contentKey);
    if (duplicate) {
      if (duplicate.content_hash !== contentHash)
        throw new InboundRejection("message_id_conflict");
      await terminal(row, "duplicate", null, duplicate.message_id);
      return;
    }
    const messageId = `r1-${row.id}`;
    const attachment = parsed.attachment
      ? {
          filename: parsed.attachment.filename,
          contentType: parsed.attachment.contentType,
          byteSize: parsed.attachment.bytes.byteLength,
          checksum: parsed.attachment.checksum,
          objectKey: `quote-conversation/${messageId}`,
        }
      : null;
    try {
      const reserved = await repository.reserve({
        receiptId: row.id,
        leaseId: row.lease_id!,
        messageId,
        requestId: scope.requestId,
        profileId: scope.profileId,
        byteSize: attachment?.byteSize ?? 0,
        now: now(),
      });
      if (!reserved) throw new InboundRejection("reservation_expired");
    } catch (error) {
      if (error instanceof Response && [413, 429].includes(error.status))
        throw new InboundRejection("conversation_limit");
      throw error;
    }
    if (attachment && parsed.attachment)
      await immutablePut(
        attachment.objectKey,
        new Uint8Array(parsed.attachment.bytes),
        attachment.checksum,
        attachment.contentType,
      );
    try {
      await database.batch(
        quoteInboundAppendStatements(database, {
          receiptId: row.id,
          leaseId: row.lease_id!,
          messageId,
          requestId: scope.requestId,
          profileId: scope.profileId,
          senderEmail: envelope.sender,
          tokenHash: await sha256(envelope.token),
          body: parsed.body,
          contentKey,
          contentHash,
          now: now(),
          attachment,
        }),
      );
    } catch (error) {
      // A lost batch response may hide a committed append: never retire those bytes.
      const saved = await repository.read(row.id);
      if (saved?.state === "appended") return;
      const concurrent = await repository.content(contentKey);
      if (concurrent) {
        if (concurrent.content_hash !== contentHash)
          throw new InboundRejection("message_id_conflict");
        await terminal(row, "duplicate", null, concurrent.message_id);
        return;
      }
      if (!(await input.resolveReplyToken(envelope.token, envelope.sender)))
        throw new InboundRejection("reply_not_authorized");
      if ((await repository.reservation(messageId))?.live !== 1)
        throw new InboundRejection("reservation_expired");
      throw error;
    }
  }

  return {
    async receive(message: InboundEmailMessage) {
      let bytes = new Uint8Array();
      let reason: InboundReason | null = null;
      try {
        bytes = await boundedRaw(message);
      } catch (error) {
        if (error instanceof InboundRejection) reason = error.reason;
        else throw new Error("Inbound stream unavailable");
      }
      const checksum = await sha256(bytes);
      const sender = normalizedEmail(message.from);
      const token = replyToken(message.to, env.EMAIL_REPLY_DOMAIN);
      let proof = null;
      if (!reason && input.verifyPlatformEmail) {
        proof = await input.verifyPlatformEmail({
          message,
          raw: bytes,
          rawSha256: checksum,
        });
      }
      if (!reason && !sender) reason = "invalid_envelope";
      if (!reason && !token) reason = "invalid_reply_address";
      if (
        !reason &&
        (!proof ||
          proof.mechanism !== "dmarc-aligned" ||
          proof.rawSha256 !== checksum ||
          normalizedEmail(proof.authenticatedSender) !== sender ||
          !["cloudflare-email", "local-fixture"].includes(proof.provider) ||
          (env.APP_ENV !== "local" && proof.provider !== "cloudflare-email"))
      )
        reason = "authentication_unverified";
      const scope = !reason
        ? await input.resolveReplyToken(token!, sender!)
        : null;
      if (!reason && !scope) reason = "reply_not_authorized";
      const eventId = proof?.eventId;
      if (
        !reason &&
        eventId !== undefined &&
        (!eventId ||
          eventId.length > 512 ||
          Array.from(eventId).some((character) => character.charCodeAt(0) < 32))
      )
        reason = "authentication_unverified";
      const receiptHash = await sha256(
        JSON.stringify([
          checksum,
          message.from,
          message.to,
          proof?.authenticatedSender ?? null,
        ]),
      );
      const eventKey = await sha256(
        JSON.stringify([
          proof?.provider ?? "unverified",
          eventId ?? [checksum, message.from, message.to, message.rawSize],
        ]),
      );
      const existing = await repository.byEvent(eventKey);
      if (existing && existing.receipt_hash !== receiptHash) {
        const conflictKey = await sha256(`conflict:${eventKey}:${receiptHash}`);
        await repository.insert({
          id: crypto.randomUUID(),
          eventKey: conflictKey,
          receiptHash,
          checksum,
          rawSize: bytes.byteLength,
          rawKey: null,
          envelope: null,
          state: "quarantined",
          reason: "provider_event_conflict",
          now: now(),
          requestId: null,
        });
        const conflict = (await repository.byEvent(conflictKey))!;
        return {
          receiptId: conflict.id,
          state: conflict.state,
          reason: conflict.reason,
        };
      }
      const id = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        const envelope: ProtectedEnvelope | null = !reason
          ? {
              sender: sender!,
              token: token!,
              requestId: scope!.requestId,
              profileId: scope!.profileId,
              rawChecksum: checksum,
              provider: proof!.provider,
            }
          : null;
        await repository.insert({
          id,
          eventKey,
          receiptHash,
          checksum,
          rawSize: bytes.byteLength,
          rawKey: envelope ? `quote-inbound-email/raw/${id}` : null,
          envelope: envelope
            ? await protector.seal(JSON.stringify(envelope), `inbound:${id}`)
            : null,
          state: reason ? "quarantined" : "staging",
          reason,
          now: now(),
          requestId: scope?.requestId ?? null,
        });
      }
      const receipt = (await repository.byEvent(eventKey))!;
      // A concurrent insertion may have won between the first read and INSERT.
      if (receipt.receipt_hash !== receiptHash) {
        const conflictKey = await sha256(`conflict:${eventKey}:${receiptHash}`);
        await repository.insert({
          id: crypto.randomUUID(),
          eventKey: conflictKey,
          receiptHash,
          checksum,
          rawSize: bytes.byteLength,
          rawKey: null,
          envelope: null,
          state: "quarantined",
          reason: "provider_event_conflict",
          now: now(),
          requestId: null,
        });
        const conflict = (await repository.byEvent(conflictKey))!;
        return {
          receiptId: conflict.id,
          state: conflict.state,
          reason: conflict.reason,
        };
      }
      if (receipt.raw_key && active(receipt)) {
        await immutablePut(
          receipt.raw_key,
          bytes,
          receipt.raw_checksum,
          "application/octet-stream",
        );
        await repository.staged(receipt.id);
      }
      const saved = (await repository.read(receipt.id))!;
      return { receiptId: saved.id, state: saved.state, reason: saved.reason };
    },
    async dispatch(queue: InboundQueue, limit = 50) {
      let enqueued = 0;
      let failed = 0;
      for (const row of await repository.cleanupDue(
        now(),
        boundedLimit(limit),
      )) {
        if (!(await cleanup(row))) failed++;
      }
      for (const candidate of await repository.due(
        now(),
        boundedLimit(limit),
      )) {
        const row = await repository.dispatchClaim(candidate, now());
        if (!row) continue;
        try {
          await queue.send({ type: "quote-inbound-email", receiptId: row.id });
          await repository.dispatched(row);
          enqueued++;
        } catch {
          await repository.dispatchFailed(
            row,
            now(),
            inboundBackoff(row.dispatch_attempts),
            row.dispatch_attempts >= MAX_INBOUND_ATTEMPTS,
          );
          const saved = await repository.read(row.id);
          if (saved && !active(saved)) await cleanup(saved);
          failed++;
        }
      }
      return { enqueued, failed };
    },
    async consume(message: InboundQueueMessage): Promise<boolean> {
      const job = inboundJob(message.body);
      if (!job) return false;
      try {
        const row = await repository.claim(
          job.receiptId,
          now(),
          crypto.randomUUID(),
        );
        if (row) {
          try {
            if (row.attempts > MAX_INBOUND_ATTEMPTS)
              await terminal(row, "dead_letter", "attempts_exhausted");
            else await process(row);
          } catch (error) {
            if (error instanceof InboundRejection)
              await terminal(row, "quarantined", error.reason);
            else if (row.attempts >= MAX_INBOUND_ATTEMPTS)
              await terminal(row, "dead_letter", "attempts_exhausted");
            else
              await repository.retry(row, now(), inboundBackoff(row.attempts));
          }
        }
        const saved = await repository.read(job.receiptId);
        if (!saved) message.ack();
        else if (!active(saved)) {
          if (await cleanup(saved)) message.ack();
          else message.retry({ delaySeconds: 60 });
        } else
          message.retry({
            delaySeconds: Math.min(
              43_200,
              Math.max(
                1,
                Math.ceil(
                  (Math.max(saved.next_attempt_at, saved.lease_until ?? 0) -
                    now()) /
                    1000,
                ),
              ),
            ),
          });
      } catch {
        message.retry({ delaySeconds: 60 });
      }
      return true;
    },
    async listAdmin(
      actor: AdminIdentity | null | undefined,
      query: InboundAdminQuery = {},
    ) {
      if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
        throw new Response("Forbidden", { status: 403 });
      if (
        query.state &&
        ![
          "staging",
          "pending",
          "processing",
          "retry",
          "appended",
          "duplicate",
          "quarantined",
          "dead_letter",
        ].includes(query.state)
      )
        throw new Response("Invalid receipt state", { status: 400 });
      return repository.list(
        boundedLimit(query.limit ?? 50),
        query.cursor,
        query.state,
      );
    },
  };
}
