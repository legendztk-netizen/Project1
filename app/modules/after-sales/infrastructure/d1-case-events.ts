import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { customerMessageStatements } from "./d1-customer-messages";

/**
 * Statements appending one customer-visible operation-record event to a
 * Case, bumping the Case version, and (when `email` is set) the matching
 * Messages entry labelled with the Case. `guard` is true only when the
 * business record was written, so a failed or replayed command appends
 * nothing. The event id is `case-event:<commandId>`.
 */
export async function caseEventStatements(
  db: D1Database,
  input: {
    caseId: string;
    orderRequestId: string;
    actorId: string;
    body: string;
    email: string | null;
    commandId: string;
    timestamp: string;
    guard: { sql: string; bindings: unknown[] };
    messageId?: string;
  },
) {
  const id = `case-event:${input.commandId}`;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO after_sales_case_messages
         (id,case_id,author_role,author_id,visibility,kind,body,created_at,
          command_id,command_hash)
         SELECT ?,?,'admin',?,'customer','event',?,?,?,? WHERE ${input.guard.sql}`,
      )
      .bind(
        id,
        input.caseId,
        input.actorId,
        input.body,
        input.timestamp,
        id,
        await piSha256(new TextEncoder().encode(input.body)),
        ...input.guard.bindings,
      ),
    db
      .prepare(
        `UPDATE after_sales_cases SET version=version+1,updated_at=?
         WHERE id=? AND EXISTS(SELECT 1 FROM after_sales_case_messages WHERE id=?)`,
      )
      .bind(input.timestamp, input.caseId, id),
  ];
  if (input.email)
    statements.push(
      ...(await customerMessageStatements(db, {
        orderRequestId: input.orderRequestId,
        actorId: input.actorId,
        messageId: input.messageId ?? `case-event-email:${input.commandId}`,
        body: input.email,
        caseId: input.caseId,
        timestamp: input.timestamp,
        guard: {
          sql: "EXISTS(SELECT 1 FROM after_sales_case_messages WHERE id=?)",
          bindings: [id],
        },
      })),
    );
  return { id, statements };
}
