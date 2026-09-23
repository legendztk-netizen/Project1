import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";
import { piSha256 } from "../domain/proforma-invoice";

// Used by both payment confirmation and PI acceptance batches. D1 executes the
// whole batch atomically; the unique RFQ/PI constraints settle racing final events.
export async function orderCreationStatements(
  db: D1Database,
  input: {
    piId: string;
    requestId: string;
    now: string;
    finalEvent: "payment" | "acceptance";
  },
) {
  const orderId = `order:${input.piId}`;
  const auditId = `order-created:${input.piId}`;
  const messageId = `order-created-message:${input.piId}`;
  const body =
    input.finalEvent === "payment"
      ? "Payment has been confirmed. Your order is now available in My Orders."
      : "Your PI acceptance completed the order. View the confirmed order in My Orders.";
  const messageHash = await piSha256(new TextEncoder().encode(body));
  return [
    db
      .prepare(
        `INSERT INTO confirmed_orders(id,order_number,request_id,pi_id,purchasing_context_id,acceptance_id,
       confirmation_id,snapshot_json,snapshot_hash,currency,total_cents,confirmed_at,reverification_id)
       SELECT ?, 'ORD-'||substr(p.document_number,4),p.request_id,p.id,pay.purchasing_context_id,
         a.id,c.id,p.snapshot_json,p.snapshot_hash,'USD',pay.total_due_cents,?,
         (SELECT r.id FROM pi_payment_reverifications r WHERE r.pi_id=p.id
           ORDER BY r.reverified_at DESC,r.id DESC LIMIT 1)
       FROM proforma_invoices p
       JOIN pi_payment_accounts pay ON pay.pi_id=p.id
       JOIN pi_acceptances a ON a.pi_id=p.id AND a.request_id=p.request_id
       JOIN pi_payment_confirmations c ON c.pi_id=p.id
       JOIN proforma_invoice_heads h ON h.request_id=p.request_id AND h.pi_id=p.id
       JOIN quote_revisions q ON q.id=p.quote_revision_id AND q.request_id=p.request_id
       WHERE p.id=? AND pay.term_kind!='legacy_review' AND pay.receipt_history_known=1
         AND pay.confirmation_valid=1
         AND NOT EXISTS(SELECT 1 FROM pi_payment_disputes d WHERE d.pi_id=p.id AND d.active=1)
         AND pay.currency='USD' AND pay.total_due_cents>0
         AND pay.amount_received_cents+pay.allocated_in_cents-pay.allocated_out_cents-pay.refunded_cents>=pay.total_due_cents
         AND c.confirmed_cents=pay.total_due_cents AND c.currency='USD'
         AND pay.due_at IS NOT NULL AND (pay.due_at>=? OR EXISTS(
           SELECT 1 FROM pi_late_payment_reviews review WHERE review.pi_id=p.id
             AND review.decision='same_terms_approved' AND review.reviewed_at>=pay.due_at))
         AND a.document_version=p.document_version AND a.snapshot_hash=p.snapshot_hash
         AND a.quote_revision_id=p.quote_revision_id
         AND p.quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=p.request_id ORDER BY revision_number DESC LIMIT 1)
         AND (NOT EXISTS(SELECT 1 FROM json_each(p.snapshot_json,'$.lines') line
           WHERE json_extract(line.value,'$.madeToOrder')=1)
           OR json_extract(q.snapshot_json,'$.factoryReviewConfirmed')=1)
       ON CONFLICT(request_id) DO NOTHING`,
      )
      .bind(orderId, input.now, input.piId, input.now),
    db
      .prepare(
        `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
       SELECT ?,'order.created','confirmed_order',o.id,c.actor_id,
         json_object('piId',o.pi_id,'acceptanceId',o.acceptance_id,'confirmationId',o.confirmation_id,'finalEvent',?),?
       FROM confirmed_orders o JOIN pi_payment_confirmations c ON c.id=o.confirmation_id
       WHERE o.id=? AND changes()=1`,
      )
      .bind(auditId, input.finalEvent, input.now, orderId),
    db
      .prepare(
        `INSERT INTO order_release_guards(order_id,held,updated_at)
      SELECT id,0,? FROM confirmed_orders WHERE id=?
      ON CONFLICT(order_id) DO NOTHING`,
      )
      .bind(input.now, orderId),
    db
      .prepare(
        `INSERT INTO confirmed_order_lines(order_id,line_id,line_number,line_kind,snapshot_json)
       SELECT o.id,json_extract(line.value,'$.id'),CAST(line.key AS INTEGER)+1,
         json_extract(line.value,'$.lineKind'),line.value
       FROM confirmed_orders o,json_each(o.snapshot_json,'$.lines') line
       WHERE o.id=? AND EXISTS(SELECT 1 FROM admin_audit_events WHERE id=?)
       ON CONFLICT(order_id,line_id) DO NOTHING`,
      )
      .bind(orderId, auditId),
    db
      .prepare(
        `INSERT INTO order_fulfillment_initializations(order_id,line_id,initialized_at)
       SELECT order_id,line_id,? FROM confirmed_order_lines WHERE order_id=?
       ON CONFLICT(order_id,line_id) DO NOTHING`,
      )
      .bind(input.now, orderId),
    db
      .prepare(
        `INSERT INTO order_assembly_production_initializations(order_id,line_id,initialized_at)
       SELECT order_id,line_id,? FROM confirmed_order_lines
       WHERE order_id=? AND line_kind='configured_assembly'
       ON CONFLICT(order_id,line_id) DO NOTHING`,
      )
      .bind(input.now, orderId),
    db
      .prepare(
        `INSERT INTO quote_conversations(request_id,created_at)
       SELECT request_id,? FROM confirmed_orders WHERE id=?
       ON CONFLICT(request_id) DO NOTHING`,
      )
      .bind(input.now, orderId),
    db
      .prepare(
        `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,
       created_at,command_id,payload_hash,source,delivery_state)
       SELECT ?,o.request_id,'admin',c.actor_id,?,?,?,?,'website','available'
       FROM confirmed_orders o JOIN pi_payment_confirmations c ON c.id=o.confirmation_id
       WHERE o.id=? ON CONFLICT(command_id) DO NOTHING`,
      )
      .bind(messageId, body, input.now, messageId, messageHash, orderId),
    quoteNotificationOutboxStatement(db, {
      messageId,
      requestId: input.requestId,
      createdAt: input.now,
    }),
    db
      .prepare(
        `INSERT INTO pi_order_finalization_assertions(id,pi_id,valid,asserted_at)
       SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM confirmed_orders WHERE pi_id=?) THEN 1 ELSE 0 END,?
       WHERE EXISTS(SELECT 1 FROM pi_acceptances WHERE pi_id=?)
         AND EXISTS(SELECT 1 FROM pi_payment_confirmations WHERE pi_id=?)
         AND EXISTS(SELECT 1 FROM pi_payment_accounts WHERE pi_id=? AND confirmation_valid=1)
         AND NOT EXISTS(SELECT 1 FROM pi_payment_disputes WHERE pi_id=? AND active=1)
       ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        `order-finalized:${input.finalEvent}:${input.piId}`,
        input.piId,
        input.piId,
        input.now,
        input.piId,
        input.piId,
        input.piId,
        input.piId,
      ),
  ];
}
