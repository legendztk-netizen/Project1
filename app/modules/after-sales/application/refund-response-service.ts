import {
  etDisplayDate,
  refundInitiationDeadline,
} from "../domain/return-policy";
import { usd } from "../domain/refund-calculation";
import { customerMessageStatements } from "../infrastructure/d1-customer-messages";
import { createD1OrderFacts } from "../infrastructure/d1-order-facts";
import { readRefundAuthorizations } from "../infrastructure/d1-refund-authorizations";
import { afterSalesCommandId, afterSalesText } from "./after-sales-command";

const conflict = () =>
  new Response("Refund state changed; reload", { status: 409 });

/**
 * The customer's gross-to-net confirmation or dispute of a refund that
 * deducts a documented third-party cost (cancellation or return). Confirming
 * approves the refund and starts its initiation deadline.
 */
export function createRefundResponseService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string | null } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const facts = createD1OrderFacts(db);
  return {
    async customerRespond(
      profileId: string,
      input: {
        orderId: string;
        authorizationId: string;
        expectedVersion: number;
        response: "confirm" | "dispute";
        note?: string;
        commandId: string;
      },
    ) {
      const commandId = afterSalesCommandId(input.commandId);
      const orderId = await facts.ownedOrder(profileId, input.orderId);
      if (!["confirm", "dispute"].includes(input.response))
        throw new Response("Invalid response", { status: 400 });
      const note =
        input.response === "dispute"
          ? afterSalesText(input.note, "What should be reviewed")
          : null;
      const eventId = `refund-response:${commandId}`;
      const replay = await db
        .prepare(
          `SELECT authorization_id,actor_id FROM after_sales_refund_events WHERE id=?`,
        )
        .bind(eventId)
        .first<{ authorization_id: string; actor_id: string }>();
      if (replay) {
        if (
          replay.authorization_id !== input.authorizationId ||
          replay.actor_id !== profileId
        )
          throw conflict();
        return;
      }
      const [authorization] = await readRefundAuthorizations(db, {
        ids: [input.authorizationId],
      });
      if (!authorization || authorization.order_id !== orderId)
        throw new Response("Refund not found", { status: 404 });
      if (
        authorization.version !== input.expectedVersion ||
        !["awaiting_customer_confirmation", "disputed"].includes(
          authorization.status,
        ) ||
        (input.response === "dispute" &&
          authorization.status !== "awaiting_customer_confirmation")
      )
        throw conflict();
      const timestamp = now();
      const deadline =
        input.response === "confirm"
          ? refundInitiationDeadline(timestamp)
          : null;
      const orderFacts = await facts.read(orderId);
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE after_sales_refund_authorizations
           SET status=?,version=version+1,approved_at=?,deadline_date_et=?,
             deadline_at=?,calendar_version=?,customer_response_at=?,
             customer_response_by=?
           WHERE id=? AND order_id=? AND version=?`,
          )
          .bind(
            input.response === "confirm" ? "approved" : "disputed",
            deadline ? timestamp : null,
            deadline?.dateEt ?? null,
            deadline?.at ?? null,
            deadline?.calendarVersion ?? null,
            timestamp,
            profileId,
            authorization.id,
            orderId,
            input.expectedVersion,
          ),
        db
          .prepare(
            `INSERT INTO after_sales_refund_events
           (id,authorization_id,kind,details_json,actor_id,occurred_at,command_id)
           SELECT ?,?,?,?,?,?,? WHERE changes()=1`,
          )
          .bind(
            eventId,
            authorization.id,
            input.response === "confirm"
              ? "customer_confirmed"
              : "customer_disputed",
            JSON.stringify({ note, refundCents: authorization.refund_cents }),
            profileId,
            timestamp,
            commandId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
           (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
           SELECT ?,?,'confirmed_order',?,?,?,?
           WHERE EXISTS(SELECT 1 FROM after_sales_refund_events WHERE id=?)`,
          )
          .bind(
            eventId,
            input.response === "confirm"
              ? "order.refund_customer_confirmed"
              : "order.refund_customer_disputed",
            orderId,
            profileId,
            JSON.stringify({
              authorizationId: authorization.id,
              note,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
            eventId,
          ),
      ];
      if (deadline)
        statements.push(
          ...(await customerMessageStatements(db, {
            orderRequestId: orderFacts.requestId,
            actorId: "system",
            messageId: `refund-confirmed:${commandId}`,
            body: `Thank you. Your refund of ${usd(authorization.refund_cents)} for Order ${orderFacts.orderNumber} is approved. It has not been sent yet; we will initiate it by ${etDisplayDate(deadline.dateEt)} ET.`,
            timestamp,
            guard: {
              sql: "EXISTS(SELECT 1 FROM after_sales_refund_events WHERE id=?)",
              bindings: [eventId],
            },
          })),
        );
      try {
        const results = await db.batch(statements);
        if (results[0].meta.changes !== 1) throw conflict();
      } catch (error) {
        if (error instanceof Response) throw error;
        throw conflict();
      }
    },
  };
}
