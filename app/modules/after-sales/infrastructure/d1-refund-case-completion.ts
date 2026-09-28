/** Close only the fully resolved Case, in the same transaction as the final remittance. */
export function refundCaseCompletionStatements(
  db: D1Database,
  input: {
    caseId: string;
    orderId: string;
    actorId: string;
    initiationId: string;
    commandId: string;
    timestamp: string;
  },
) {
  const eventId = `case-refund-completed:${input.initiationId}`;
  return [
    db
      .prepare(
        `UPDATE after_sales_cases SET status='closed',version=version+1,updated_at=?
      WHERE id=? AND order_id=? AND status='open'
      AND NOT EXISTS(SELECT 1 FROM after_sales_case_lines l WHERE l.case_id=after_sales_cases.id AND l.physical_quantity >
        coalesce((SELECT sum(r.physical_quantity) FROM after_sales_receipt_lines r WHERE r.case_id=l.case_id AND r.line_id=l.line_id AND r.shipment_id=l.shipment_id),0))
      AND NOT EXISTS(SELECT 1 FROM after_sales_return_receipts r WHERE r.case_id=after_sales_cases.id
        AND NOT EXISTS(SELECT 1 FROM after_sales_return_decisions d WHERE d.receipt_id=r.id))
      AND NOT EXISTS(SELECT 1 FROM after_sales_return_decisions d WHERE d.case_id=after_sales_cases.id AND d.remedy='replacement')
      AND NOT EXISTS(SELECT 1 FROM after_sales_refund_authorizations a WHERE a.status!='superseded'
        AND (a.source_id IN (SELECT id FROM after_sales_return_decisions WHERE case_id=after_sales_cases.id)
          OR a.source_id IN (SELECT id FROM after_sales_decision_revisions WHERE case_id=after_sales_cases.id))
        AND (a.status!='approved' OR a.refund_cents > coalesce((SELECT sum(i.amount_cents) FROM after_sales_refund_initiations i WHERE i.authorization_id=a.id),0)
          OR EXISTS(SELECT 1 FROM after_sales_refund_holds h WHERE h.authorization_id=a.id AND h.released_at IS NULL)))`,
      )
      .bind(input.timestamp, input.caseId, input.orderId),
    db
      .prepare(
        `INSERT INTO after_sales_case_messages
      (id,case_id,author_role,author_id,visibility,kind,body,created_at,command_id,command_hash)
      SELECT ?,?,'admin',?,'customer','event',?,?,?,? WHERE changes()=1`,
      )
      .bind(
        eventId,
        input.caseId,
        input.actorId,
        "Refund sent. All returns and refunds for this case have been processed, and the case is closed. Your bank may take additional time to credit the funds.",
        input.timestamp,
        eventId,
        input.commandId,
      ),
    db
      .prepare(
        `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
      SELECT ?,'order.case_refund_completed','confirmed_order',?,?,?,? WHERE EXISTS(SELECT 1 FROM after_sales_case_messages WHERE id=?)`,
      )
      .bind(
        eventId,
        input.orderId,
        input.actorId,
        JSON.stringify({
          caseId: input.caseId,
          initiationId: input.initiationId,
          commandId: input.commandId,
        }),
        input.timestamp,
        eventId,
      ),
  ];
}
