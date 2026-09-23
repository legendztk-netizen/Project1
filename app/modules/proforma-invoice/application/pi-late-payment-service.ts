import type { AdminIdentity } from "#workers/admin-access";
import { dueDateInstant } from "../domain/pi-payment-terms";
import { piSha256 } from "../domain/proforma-invoice";
import { orderCreationStatements } from "../infrastructure/d1-order-creation";
import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";

interface Account {
  pi_id: string;
  request_id: string;
  document_number: string;
  version: number;
  term_kind: string;
  due_date_et: string | null;
  due_at: string | null;
  late_review_required: number;
  accepted_at: string | null;
  current_pi_id: string | null;
  amount_received_cents: number;
  allocated_in_cents: number;
  allocated_out_cents: number;
  refunded_cents: number;
  total_due_cents: number;
  receipt_history_known: number;
  actual_channel: string | null;
  confirmation_id: string | null;
  order_id: string | null;
}

const hash = (text: string) => piSha256(new TextEncoder().encode(text));
function required(value: string, name: string) {
  if (!value?.trim() || value.trim().length > 1000)
    throw new Response(`${name} required`, { status: 400 });
  return value.trim();
}
function checkActor(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}
function conflict() {
  return new Response("PI payment state changed; reload", { status: 409 });
}

export function createPiLatePaymentService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  async function account(piId: string) {
    const row = await db
      .prepare(
        `SELECT pay.*,p.document_number,
      (SELECT accepted_at FROM pi_acceptances WHERE pi_id=p.id) AS accepted_at,
      (SELECT pi_id FROM proforma_invoice_heads WHERE request_id=p.request_id) AS current_pi_id,
      (SELECT id FROM pi_payment_confirmations WHERE pi_id=p.id) AS confirmation_id,
      (SELECT id FROM confirmed_orders WHERE pi_id=p.id) AS order_id
      FROM pi_payment_accounts pay JOIN proforma_invoices p ON p.id=pay.pi_id WHERE pay.pi_id=?`,
      )
      .bind(required(piId, "PI id"))
      .first<Account>();
    if (!row) throw new Response("PI not found", { status: 404 });
    return row;
  }
  return {
    async read(actor: AdminIdentity, piId: string) {
      checkActor(actor);
      const row = await account(piId);
      return {
        dueDateEt: row.due_date_et,
        dueAt: row.due_at,
        overdue:
          !!row.accepted_at &&
          !!row.due_at &&
          (row.due_at < now() || row.late_review_required === 1) &&
          !row.order_id,
        extensions: (
          await db
            .prepare(
              `SELECT id,old_due_date_et AS oldDate,new_due_date_et AS newDate,
          reason,extended_at AS extendedAt FROM pi_payment_deadline_extensions WHERE pi_id=?
          ORDER BY extended_at DESC,id DESC`,
            )
            .bind(piId)
            .all()
        ).results,
        reviews: (
          await db
            .prepare(
              `SELECT id,decision,reason,reviewed_at AS reviewedAt
          FROM pi_late_payment_reviews WHERE pi_id=? ORDER BY reviewed_at DESC,id DESC`,
            )
            .bind(piId)
            .all()
        ).results,
      };
    },
    async extend(
      actor: AdminIdentity,
      input: {
        piId: string;
        commandId: string;
        expectedVersion: number;
        newDateEt: string;
        reason: string;
      },
    ) {
      checkActor(actor);
      const reason = required(input.reason, "Extension reason");
      const newDueAt = dueDateInstant(input.newDateEt);
      const before = await account(input.piId);
      const timestamp = now();
      const commandHash = await hash(
        JSON.stringify({ ...input, reason, actorId: actor.id }),
      );
      const previous = await db
        .prepare(
          "SELECT command_hash FROM pi_payment_deadline_extensions WHERE command_id=?",
        )
        .bind(input.commandId)
        .first<{ command_hash: string }>();
      if (previous) {
        if (previous.command_hash !== commandHash) throw conflict();
        return this.read(actor, input.piId);
      }
      if (
        before.current_pi_id !== input.piId ||
        !before.accepted_at ||
        !before.due_at ||
        !before.due_date_et ||
        before.version !== input.expectedVersion ||
        newDueAt <= before.due_at ||
        before.order_id
      )
        throw conflict();
      const id = crypto.randomUUID();
      const messageId = `pi-deadline-extension:${id}`;
      const body = `The payment deadline for ${before.document_number} has been extended to ${input.newDateEt} at 11:59 PM Eastern Time. Please view the current PI in My Quotes.`;
      const results = await db.batch([
        db
          .prepare(
            `UPDATE pi_payment_accounts SET due_date_et=?,due_at=?,
          late_review_required=CASE WHEN due_at<? THEN 1 ELSE late_review_required END,
          version=version+1,updated_at=?
          WHERE pi_id=? AND version=? AND due_at=? AND EXISTS(SELECT 1 FROM pi_acceptances WHERE pi_id=?)
          AND EXISTS(SELECT 1 FROM proforma_invoice_heads WHERE pi_id=?)
          AND NOT EXISTS(SELECT 1 FROM confirmed_orders WHERE pi_id=?)`,
          )
          .bind(
            input.newDateEt,
            newDueAt,
            timestamp,
            timestamp,
            input.piId,
            input.expectedVersion,
            before.due_at,
            input.piId,
            input.piId,
            input.piId,
          ),
        db
          .prepare(
            `INSERT INTO pi_payment_deadline_extensions
          (id,command_id,command_hash,pi_id,old_due_date_et,old_due_at,new_due_date_et,new_due_at,reason,actor_id,extended_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1`,
          )
          .bind(
            id,
            input.commandId,
            commandHash,
            input.piId,
            before.due_date_et,
            before.due_at,
            input.newDateEt,
            newDueAt,
            reason,
            actor.id,
            timestamp,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'pi.deadline_extended','proforma_invoice',?,?,?,?
          WHERE EXISTS(SELECT 1 FROM pi_payment_deadline_extensions WHERE id=?)`,
          )
          .bind(
            `deadline:${id}`,
            input.piId,
            actor.id,
            JSON.stringify({
              requestId: before.request_id,
              commandId: input.commandId,
              ipAddress: options.auditIp ?? null,
              from: before.due_at,
              to: newDueAt,
            }),
            timestamp,
            id,
          ),
        db
          .prepare(
            `INSERT INTO quote_conversations(request_id,created_at) SELECT ?,?
          WHERE EXISTS(SELECT 1 FROM pi_payment_deadline_extensions WHERE id=?) ON CONFLICT(request_id) DO NOTHING`,
          )
          .bind(before.request_id, timestamp, id),
        db
          .prepare(
            `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,created_at,
          command_id,payload_hash,source,delivery_state)
          SELECT ?,?,'admin',?,?,?, ?,?,'website','available'
          WHERE EXISTS(SELECT 1 FROM pi_payment_deadline_extensions WHERE id=?)`,
          )
          .bind(
            messageId,
            before.request_id,
            actor.id,
            body,
            timestamp,
            messageId,
            await hash(body),
            id,
          ),
        quoteNotificationOutboxStatement(db, {
          messageId,
          requestId: before.request_id,
          createdAt: timestamp,
        }),
      ]);
      if (results[0].meta.changes !== 1) throw conflict();
      return this.read(actor, input.piId);
    },
    async review(
      actor: AdminIdentity,
      input: {
        piId: string;
        commandId: string;
        expectedVersion: number;
        decision: "same_terms_approved" | "replacement_required";
        reason: string;
        pricingChecked: boolean;
        availabilityChecked: boolean;
        freightChecked: boolean;
        tradeTermsChecked: boolean;
        leadTimeChecked: boolean;
        externalReference?: string;
      },
    ) {
      checkActor(actor);
      const reason = required(input.reason, "Review reason");
      if (
        ![
          input.pricingChecked,
          input.availabilityChecked,
          input.freightChecked,
          input.tradeTermsChecked,
          input.leadTimeChecked,
        ].every(Boolean)
      )
        throw new Response("All commercial checks are required", {
          status: 400,
        });
      if (
        input.decision !== "same_terms_approved" &&
        input.decision !== "replacement_required"
      )
        throw new Response("Invalid review decision", { status: 400 });
      const reference =
        input.decision === "same_terms_approved"
          ? required(
              input.externalReference ?? "",
              "External funds verification",
            )
          : null;
      const commandHash = await hash(
        JSON.stringify({
          ...input,
          reason,
          externalReference: reference,
          actorId: actor.id,
        }),
      );
      const previous = await db
        .prepare(
          "SELECT command_hash FROM pi_late_payment_reviews WHERE command_id=?",
        )
        .bind(input.commandId)
        .first<{ command_hash: string }>();
      if (previous) {
        if (previous.command_hash !== commandHash) throw conflict();
        return this.read(actor, input.piId);
      }
      const before = await account(input.piId);
      const timestamp = now();
      if (
        before.current_pi_id !== input.piId ||
        !before.accepted_at ||
        !before.due_at ||
        (before.due_at >= timestamp && before.late_review_required !== 1) ||
        before.version !== input.expectedVersion ||
        before.order_id ||
        before.confirmation_id
      )
        throw conflict();
      if (
        input.decision === "same_terms_approved" &&
        (!before.receipt_history_known ||
          before.amount_received_cents +
            before.allocated_in_cents -
            before.allocated_out_cents -
            before.refunded_cents <
            before.total_due_cents ||
          !before.actual_channel ||
          before.term_kind === "legacy_review")
      )
        throw conflict();
      const id = crypto.randomUUID();
      const confirmId = crypto.randomUUID();
      const orderStatements =
        input.decision === "same_terms_approved"
          ? await orderCreationStatements(db, {
              piId: input.piId,
              requestId: before.request_id,
              now: timestamp,
              finalEvent: "payment",
            })
          : [];
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO pi_late_payment_reviews(id,command_id,command_hash,pi_id,decision,
          pricing_checked,availability_checked,freight_checked,trade_terms_checked,lead_time_checked,
          reason,actor_id,reviewed_at)
          SELECT ?,?,?,pay.pi_id,?,1,1,1,1,1,?,?,?
          FROM pi_payment_accounts pay JOIN proforma_invoice_heads h ON h.pi_id=pay.pi_id
          JOIN proforma_invoices p ON p.id=pay.pi_id
          JOIN pi_acceptances a ON a.pi_id=pay.pi_id
          WHERE pay.pi_id=? AND pay.version=? AND (pay.due_at<? OR pay.late_review_required=1)
          AND NOT EXISTS(SELECT 1 FROM confirmed_orders WHERE pi_id=pay.pi_id)
          AND NOT EXISTS(SELECT 1 FROM pi_payment_confirmations WHERE pi_id=pay.pi_id)
          AND (?='replacement_required' OR (
            pay.receipt_history_known=1 AND pay.term_kind!='legacy_review'
            AND pay.total_due_cents>0 AND pay.amount_received_cents+pay.allocated_in_cents-pay.allocated_out_cents-pay.refunded_cents>=pay.total_due_cents
            AND pay.actual_channel IS NOT NULL AND pay.currency='USD'
            AND a.document_version=p.document_version AND a.snapshot_hash=p.snapshot_hash
            AND a.quote_revision_id=p.quote_revision_id
            AND p.quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=p.request_id
              ORDER BY revision_number DESC LIMIT 1)
            AND NOT EXISTS(SELECT 1 FROM confirmed_orders WHERE request_id=p.request_id)
            AND (NOT EXISTS(SELECT 1 FROM json_each(p.snapshot_json,'$.lines') line
              WHERE json_extract(line.value,'$.madeToOrder')=1)
              OR EXISTS(SELECT 1 FROM quote_revisions q WHERE q.id=p.quote_revision_id
                AND json_extract(q.snapshot_json,'$.factoryReviewConfirmed')=1))
          ))`,
          )
          .bind(
            id,
            input.commandId,
            commandHash,
            input.decision,
            reason,
            actor.id,
            timestamp,
            input.piId,
            input.expectedVersion,
            timestamp,
            input.decision,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'pi.late_payment_reviewed','proforma_invoice',?,?,?,?
          WHERE EXISTS(SELECT 1 FROM pi_late_payment_reviews WHERE id=?)`,
          )
          .bind(
            `late-review:${id}`,
            input.piId,
            actor.id,
            JSON.stringify({
              requestId: before.request_id,
              commandId: input.commandId,
              ipAddress: options.auditIp ?? null,
              decision: input.decision,
              reason,
            }),
            timestamp,
            id,
          ),
        ...(input.decision === "same_terms_approved"
          ? [
              db
                .prepare(
                  `INSERT INTO pi_payment_confirmations(id,command_id,command_hash,pi_id,confirmed_cents,currency,
            actual_channel,external_reference,actor_id,confirmed_at)
            SELECT ?,?,?,pay.pi_id,pay.total_due_cents,'USD',pay.actual_channel,?,?,?
            FROM pi_payment_accounts pay JOIN proforma_invoices p ON p.id=pay.pi_id
            JOIN proforma_invoice_heads h ON h.pi_id=p.id
            JOIN pi_acceptances a ON a.pi_id=p.id AND a.document_version=p.document_version
              AND a.snapshot_hash=p.snapshot_hash AND a.quote_revision_id=p.quote_revision_id
            JOIN quote_revisions q ON q.id=p.quote_revision_id
            WHERE pay.pi_id=? AND pay.version=? AND pay.receipt_history_known=1
              AND pay.amount_received_cents+pay.allocated_in_cents-pay.allocated_out_cents-pay.refunded_cents>=pay.total_due_cents AND pay.total_due_cents>0
              AND pay.actual_channel IS NOT NULL AND (pay.due_at<? OR pay.late_review_required=1)
              AND p.quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=p.request_id
                ORDER BY revision_number DESC LIMIT 1)
              AND (NOT EXISTS(SELECT 1 FROM json_each(p.snapshot_json,'$.lines') line
                 WHERE json_extract(line.value,'$.madeToOrder')=1)
                 OR json_extract(q.snapshot_json,'$.factoryReviewConfirmed')=1)
              AND EXISTS(SELECT 1 FROM pi_late_payment_reviews WHERE id=? AND decision='same_terms_approved')`,
                )
                .bind(
                  confirmId,
                  `late-confirm:${input.commandId}`,
                  commandHash,
                  reference,
                  actor.id,
                  timestamp,
                  input.piId,
                  input.expectedVersion,
                  timestamp,
                  id,
                ),
              ...orderStatements,
            ]
          : []),
      ]);
      if (results[0].meta.changes !== 1) throw conflict();
      if (input.decision === "same_terms_approved") {
        const order = await db
          .prepare("SELECT id FROM confirmed_orders WHERE pi_id=?")
          .bind(input.piId)
          .first();
        if (!order)
          throw new Response("Late review did not create an order", {
            status: 409,
          });
      }
      return this.read(actor, input.piId);
    },
  };
}
