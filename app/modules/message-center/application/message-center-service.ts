import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { createQuoteConversationService } from "../../quote-conversation/application/quote-conversation-service";
import { requireReviewMutation } from "../../quote-review/domain/private-review";
import {
  createD1MessageCenter,
  type AdminThreadFilter,
} from "../infrastructure/d1-message-center";

export type { MessageThreadSummary } from "../infrastructure/d1-message-center";
export type { AdminThreadFilter } from "../infrastructure/d1-message-center";

const commandPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 1000
    ? number
    : 1;
}

export function adminThreadFilter(value: string | null): AdminThreadFilter {
  return value === "unread" || value === "awaiting" ? value : "all";
}

export function createMessageCenter(
  database: D1Database,
  bucket: R2Bucket,
  options: { now?: () => Date } = {},
) {
  const repository = createD1MessageCenter(database);
  const now = () => (options.now?.() ?? new Date()).toISOString();

  // Only what the reader has actually seen counts as read: the newest message
  // on the latest page, never the wall clock, so a message that arrives while
  // the page renders stays unread.
  async function markSeen(
    requestId: string,
    role: "customer" | "admin",
    readerId: string,
    messages: Array<{ createdAt: string }>,
    before: string | undefined,
  ) {
    const newest = messages.at(-1)?.createdAt;
    if (before || !newest) return;
    await repository.markRead({ requestId, role, readerId, at: newest });
  }

  return {
    customer(profileId: string) {
      const conversation = createQuoteConversationService(database, bucket, {
        kind: "customer",
        profileId,
      });
      return {
        threads: (value?: unknown) =>
          repository.customerThreads(profileId, page(value)),
        unread: () => repository.customerUnread(profileId),
        async thread(requestId: string, before?: string) {
          const messages = await conversation.list(requestId, { before });
          const context = await repository.context(requestId);
          await markSeen(
            requestId,
            "customer",
            profileId,
            messages.messages,
            before,
          );
          return {
            messages,
            context: { ...context, customerEmail: null },
          };
        },
        send: conversation.send,
        download: conversation.download,
      };
    },

    admin(identity: AdminIdentity) {
      const conversation = createQuoteConversationService(database, bucket, {
        kind: "admin",
        identity,
      });
      return {
        threads: (input: {
          filter: AdminThreadFilter;
          query: string;
          page?: unknown;
        }) =>
          repository.adminThreads(identity.id, {
            filter: input.filter,
            query: input.query,
            page: page(input.page),
          }),
        unreadThreads: () => repository.adminUnreadThreads(identity.id),
        async thread(requestId: string, before?: string) {
          const messages = await conversation.list(requestId, { before });
          const [context, notes] = await Promise.all([
            repository.context(requestId),
            repository.notes(requestId),
          ]);
          await markSeen(
            requestId,
            "admin",
            identity.id,
            messages.messages,
            before,
          );
          return { messages, context, notes };
        },
        send: conversation.send,
        download: conversation.download,
        async addNote(input: {
          request: Request;
          requestId: string;
          caseId?: string | null;
          body: string;
          commandId: string;
        }) {
          requireReviewMutation(input.request);
          if (!commandPattern.test(input.commandId))
            throw new Response("Command id required", { status: 400 });
          const body = input.body.trim();
          if (!body || body.length > 5000)
            throw new Response("Note must contain 1–5000 characters", {
              status: 400,
            });
          const caseId = input.caseId?.trim() || null;
          const context = await repository.context(input.requestId);
          if (caseId && !context.cases.some((item) => item.id === caseId))
            throw new Response("Choose a case from this order", {
              status: 400,
            });
          const commandId = input.commandId.toLowerCase();
          const commandHash = await piSha256(
            new TextEncoder().encode(
              JSON.stringify([input.requestId, identity.id, caseId, body]),
            ),
          );
          const replay = async () => {
            const prior = await repository.findNoteCommand(commandId);
            if (!prior) return null;
            if (
              prior.request_id !== input.requestId ||
              prior.command_hash !== commandHash
            )
              throw new Response("Command conflict", { status: 409 });
            return prior.id;
          };
          const prior = await replay();
          if (prior) return prior;
          const id = crypto.randomUUID();
          try {
            await repository.appendNote({
              id,
              requestId: input.requestId,
              caseId,
              adminId: identity.id,
              body,
              createdAt: now(),
              commandId,
              commandHash,
            });
          } catch (error) {
            const concurrent = await replay();
            if (concurrent) return concurrent;
            throw error;
          }
          return id;
        },
      };
    },
  };
}
