import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";

/**
 * Durable customer notification for an after-sales decision: one Order
 * conversation message plus its email outbox row, written in the same batch
 * as the business record. `guard` is a SQL condition that is true only when
 * the business record was written, so a failed or replayed command sends
 * nothing. The message id is derived from the command, so repeated delivery
 * cannot create a second customer event.
 */
export async function customerMessageStatements(
  db: D1Database,
  input: {
    orderRequestId: string;
    actorId: string;
    messageId: string;
    body: string;
    timestamp: string;
    guard: { sql: string; bindings: unknown[] };
  },
) {
  const payloadHash = await piSha256(new TextEncoder().encode(input.body));
  return [
    db
      .prepare(
        `INSERT INTO quote_conversations(request_id,created_at)
         SELECT ?,? WHERE ${input.guard.sql}
         ON CONFLICT(request_id) DO NOTHING`,
      )
      .bind(input.orderRequestId, input.timestamp, ...input.guard.bindings),
    db
      .prepare(
        `INSERT INTO quote_conversation_messages
         (id,request_id,author_role,author_id,body,created_at,command_id,
          payload_hash,source,delivery_state)
         SELECT ?,?,'admin',?,?,?,?,?,'website','available' WHERE ${input.guard.sql}
         ON CONFLICT(command_id) DO NOTHING`,
      )
      .bind(
        input.messageId,
        input.orderRequestId,
        input.actorId,
        input.body,
        input.timestamp,
        input.messageId,
        payloadHash,
        ...input.guard.bindings,
      ),
    quoteNotificationOutboxStatement(db, {
      messageId: input.messageId,
      requestId: input.orderRequestId,
      createdAt: input.timestamp,
    }),
  ];
}

export { etDisplayDate } from "../domain/return-policy";
