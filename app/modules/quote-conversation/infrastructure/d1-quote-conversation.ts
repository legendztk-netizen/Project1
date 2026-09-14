import type {
  ConversationAttachment,
  ConversationAuthor,
  ConversationMessage,
} from "../domain/quote-conversation";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import { quoteNotificationOutboxStatement } from "../../quote-notifications";

export interface ConversationCommand {
  id: string;
  requestId: string;
  author: ConversationAuthor;
  commandId: string;
  payloadHash: string;
  body: string;
  createdAt: string;
  attachment: (ConversationAttachment & { objectKey: string }) | null;
}

export interface ConversationReservation {
  id: string;
  request_id: string;
  byte_size: number;
}

// D1's clock governs both expiry selection and the final append fence.
const liveReservation =
  "julianday(created_at) > julianday('now', '-10 minutes')";

interface MessageRow {
  id: string;
  author_role: ConversationAuthor["role"];
  body: string;
  created_at: string;
  source: "website";
  delivery_state: "available";
  filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  checksum: string | null;
}

function projectMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at,
    source: row.source,
    deliveryState: row.delivery_state,
    attachment:
      row.filename === null
        ? null
        : {
            filename: row.filename,
            contentType: row.content_type!,
            byteSize: row.byte_size!,
            checksum: row.checksum!,
          },
  };
}

export function createD1QuoteConversationRepository(database: D1Database) {
  const projection = `SELECT m.id,m.author_role,m.body,m.created_at,m.source,m.delivery_state,
    a.filename,a.content_type,a.byte_size,a.checksum
    FROM quote_conversation_messages m
    LEFT JOIN quote_conversation_attachments a ON a.message_id=m.id`;

  function access(requestId: string, author: ConversationAuthor) {
    return author.role === "admin"
      ? {
          sql: "SELECT id FROM customer_quote_requests WHERE id=?",
          bindings: [requestId],
        }
      : {
          sql: `SELECT request.id FROM customer_quote_requests request ${ownedQuoteRequestWhere} AND request.id=?`,
          bindings: [author.id, author.id, author.id, requestId],
        };
  }

  return {
    async requireQuote(requestId: string, author: ConversationAuthor) {
      const guard = access(requestId, author);
      const quote = await database
        .prepare(guard.sql)
        .bind(...guard.bindings)
        .first();
      if (!quote) throw new Response("Not found", { status: 404 });
    },

    async list(requestId: string, author: ConversationAuthor, before?: string) {
      const guard = access(requestId, author);
      const cursor = before
        ? await database
            .prepare(
              "SELECT id,created_at FROM quote_conversation_messages WHERE request_id=? AND id=?",
            )
            .bind(requestId, before)
            .first<{ id: string; created_at: string }>()
        : null;
      if (before && !cursor)
        throw new Response("Invalid conversation cursor", { status: 400 });
      const rows = await database
        .prepare(
          `${projection} WHERE m.request_id=?
          AND (? IS NULL OR m.created_at < ? OR (m.created_at = ? AND m.id < ?))
          AND EXISTS (${guard.sql})
          ORDER BY m.created_at DESC,m.id DESC LIMIT 51`,
        )
        .bind(
          requestId,
          cursor?.id ?? null,
          cursor?.created_at ?? null,
          cursor?.created_at ?? null,
          cursor?.id ?? null,
          ...guard.bindings,
        )
        .all<MessageRow>();
      const page = rows.results.slice(0, 50);
      return {
        messages: page.map(projectMessage).reverse(),
        nextCursor: rows.results.length > 50 ? page[page.length - 1].id : null,
      };
    },

    async message(
      requestId: string,
      messageId: string,
      author: ConversationAuthor,
    ) {
      const guard = access(requestId, author);
      const row = await database
        .prepare(
          `${projection} WHERE m.request_id=? AND m.id=? AND EXISTS (${guard.sql})`,
        )
        .bind(requestId, messageId, ...guard.bindings)
        .first<MessageRow>();
      if (!row) throw new Response("Not found", { status: 404 });
      return projectMessage(row);
    },

    findCommand(commandId: string) {
      return database
        .prepare(
          "SELECT id,request_id,author_role,author_id,payload_hash FROM quote_conversation_messages WHERE command_id=?",
        )
        .bind(commandId)
        .first<{
          id: string;
          request_id: string;
          author_role: ConversationAuthor["role"];
          author_id: string;
          payload_hash: string;
        }>();
    },

    findAttachment(
      requestId: string,
      messageId: string,
      author: ConversationAuthor,
    ) {
      const guard = access(requestId, author);
      return database
        .prepare(
          `SELECT a.object_key,a.filename,a.content_type,a.byte_size,a.checksum
           FROM quote_conversation_attachments a
           JOIN quote_conversation_messages m ON m.id=a.message_id
           WHERE m.request_id=? AND m.id=? AND EXISTS (${guard.sql})`,
        )
        .bind(requestId, messageId, ...guard.bindings)
        .first<{
          object_key: string;
          filename: string;
          content_type: string;
          byte_size: number;
          checksum: string;
        }>();
    },

    async reserve(
      command: Pick<
        ConversationCommand,
        "id" | "requestId" | "author" | "createdAt" | "attachment"
      >,
    ) {
      const guard = access(command.requestId, command.author);
      try {
        const result = await database
          .prepare(
            `INSERT INTO quote_conversation_reservations(id,request_id,author_role,author_id,byte_size,created_at)
           SELECT ?,?,?,?,?,? WHERE EXISTS (${guard.sql})`,
          )
          .bind(
            command.id,
            command.requestId,
            command.author.role,
            command.author.id,
            command.attachment?.byteSize ?? 0,
            command.createdAt,
            ...guard.bindings,
          )
          .run();
        if (!result.meta.changes)
          throw new Response("Not found", { status: 404 });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("conversation rate limit")
        )
          throw new Response("Conversation send limit reached", {
            status: 429,
            headers: { "Retry-After": "600" },
          });
        if (
          error instanceof Error &&
          error.message.includes("conversation attachment budget")
        )
          throw new Response("Conversation attachment budget exceeded", {
            status: 413,
          });
        throw error;
      }
    },

    async release(id: string) {
      await database
        .prepare("DELETE FROM quote_conversation_reservations WHERE id=?")
        .bind(id)
        .run();
    },

    async expiredReservations(requestId: string, author: ConversationAuthor) {
      const guard = access(requestId, author);
      const rows = await database
        .prepare(
          `SELECT id,request_id,byte_size FROM quote_conversation_reservations
         WHERE request_id=? AND NOT (${liveReservation}) AND EXISTS (${guard.sql})
         ORDER BY created_at,id LIMIT 50`,
        )
        .bind(requestId, ...guard.bindings)
        .all<ConversationReservation>();
      return rows.results;
    },

    abandon(id: string, expiredOnly: boolean) {
      // Invalidate the lease atomically before touching R2. An uncertain append
      // either committed before this statement (and is preserved) or must fail.
      return database
        .prepare(
          `UPDATE quote_conversation_reservations SET created_at='1970-01-01T00:00:00.000Z'
         WHERE id=? AND (?=0 OR NOT (${liveReservation}))
         AND NOT EXISTS (SELECT 1 FROM quote_conversation_messages WHERE id=?)
         RETURNING id,request_id,byte_size`,
        )
        .bind(id, expiredOnly ? 1 : 0, id)
        .first<ConversationReservation>();
    },

    async releaseCommittedReservation(id: string) {
      const result = await database
        .prepare(
          `DELETE FROM quote_conversation_reservations WHERE id=? AND EXISTS (
          SELECT 1 FROM quote_conversation_messages m WHERE m.id=quote_conversation_reservations.id
          AND m.request_id=quote_conversation_reservations.request_id)`,
        )
        .bind(id)
        .run();
      return result.meta.changes > 0;
    },

    async append(command: ConversationCommand) {
      const guard = access(command.requestId, command.author);
      const statements = [
        database
          .prepare(
            "INSERT INTO quote_conversations(request_id,created_at) VALUES(?,?) ON CONFLICT(request_id) DO NOTHING",
          )
          .bind(command.requestId, command.createdAt),
        database
          .prepare(
            `INSERT INTO quote_conversation_messages
             (id,request_id,author_role,author_id,body,created_at,command_id,payload_hash,source,delivery_state)
             VALUES(?,?,?,(SELECT ? WHERE EXISTS (${guard.sql})
               AND EXISTS (SELECT 1 FROM quote_conversation_reservations WHERE id=? AND ${liveReservation})),?,?,?,?,'website','available')`,
          )
          .bind(
            command.id,
            command.requestId,
            command.author.role,
            command.author.id,
            ...guard.bindings,
            command.id,
            command.body,
            command.createdAt,
            command.commandId,
            command.payloadHash,
          ),
      ];
      if (command.attachment) {
        const attachment = command.attachment;
        statements.push(
          database
            .prepare(
              `INSERT INTO quote_conversation_attachments
               (message_id,filename,content_type,byte_size,checksum,object_key)
               VALUES(?,?,?,?,?,?)`,
            )
            .bind(
              command.id,
              attachment.filename,
              attachment.contentType,
              attachment.byteSize,
              attachment.checksum,
              attachment.objectKey,
            ),
        );
      }
      statements.push(
        database
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES(?,'quote_conversation.message_sent','quote_conversation',?,?,?,?)`,
          )
          .bind(
            `quote-conversation:${command.id}`,
            command.requestId,
            command.author.id,
            JSON.stringify({
              messageId: command.id,
              authorRole: command.author.role,
            }),
            command.createdAt,
          ),
      );
      statements.push(
        quoteNotificationOutboxStatement(database, {
          messageId: command.id,
          requestId: command.requestId,
          createdAt: command.createdAt,
        }),
        database
          .prepare("DELETE FROM quote_conversation_reservations WHERE id=?")
          .bind(command.id),
      );
      await database.batch(statements);
    },
  };
}
