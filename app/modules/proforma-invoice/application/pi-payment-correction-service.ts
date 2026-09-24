import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../domain/proforma-invoice";
import { parseUsdCents } from "./pi-payment-service";
import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";

const digest = (value: string) => piSha256(new TextEncoder().encode(value));
const conflict = () =>
  new Response("Payment review state changed; reload", { status: 409 });
function required(value: string, label: string) {
  if (!value?.trim() || value.trim().length > 1000)
    throw new Response(`${label} required`, { status: 400 });
  return value.trim();
}
function actorCheck(actor: AdminIdentity, owner = false) {
  if (
    !actor?.id ||
    !["owner", "subaccount"].includes(actor.accountType) ||
    (owner && actor.accountType !== "owner")
  )
    throw new Response("Forbidden", { status: 403 });
}

export function createPiPaymentCorrectionService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  async function current(piId: string) {
    const row = await db
      .prepare(
        `SELECT pay.pi_id,pay.version,pay.amount_received_cents,pay.total_due_cents,
      pay.allocated_out_cents,pay.refunded_cents,pay.confirmation_valid,
      c.id AS confirmation_id,o.id AS order_id,p.request_id,p.document_number
      FROM pi_payment_accounts pay JOIN proforma_invoices p ON p.id=pay.pi_id
      LEFT JOIN pi_payment_confirmations c ON c.pi_id=pay.pi_id
      LEFT JOIN confirmed_orders o ON o.pi_id=pay.pi_id WHERE pay.pi_id=?`,
      )
      .bind(required(piId, "PI id"))
      .first<{
        pi_id: string;
        version: number;
        amount_received_cents: number;
        total_due_cents: number;
        allocated_out_cents: number;
        refunded_cents: number;
        confirmation_valid: number;
        confirmation_id: string | null;
        order_id: string | null;
        request_id: string;
        document_number: string;
      }>();
    if (!row) throw new Response("PI not found", { status: 404 });
    return row;
  }
  const impacted = `WITH RECURSIVE impacted(pi_id) AS (
    SELECT pi_id FROM pi_payment_corrections WHERE id=?
    UNION SELECT r.target_pi_id FROM pi_fund_resolutions r
      JOIN impacted i ON i.pi_id=r.source_pi_id WHERE r.kind='allocation'
  )`;
  return {
    async read(actor: AdminIdentity, piId: string) {
      actorCheck(actor);
      const row = await current(piId);
      const disputes = (
        await db
          .prepare(
            `SELECT d.pi_id,d.correction_id,c.pi_id AS source_pi_id,d.active,
        o.id AS order_id,g.held FROM pi_payment_disputes d
        JOIN pi_payment_corrections c ON c.id=d.correction_id
        LEFT JOIN confirmed_orders o ON o.pi_id=d.pi_id
        LEFT JOIN order_release_guards g ON g.order_id=o.id
        WHERE d.pi_id=? OR d.correction_id IN
          (SELECT id FROM pi_payment_corrections WHERE pi_id=?)`,
          )
          .bind(piId, piId)
          .all()
      ).results;
      return {
        piId,
        confirmationId: row.confirmation_id,
        orderId: row.order_id,
        version: row.version,
        amountReceivedCents: row.amount_received_cents,
        confirmationValid: row.confirmation_valid === 1,
        disputes,
      };
    },
    async correct(
      actor: AdminIdentity,
      input: {
        piId: string;
        commandId: string;
        expectedVersion: number;
        correctedAmount: string;
        reason: string;
      },
    ) {
      actorCheck(actor);
      const piId = required(input.piId, "PI id");
      const commandId = required(input.commandId, "Command ID");
      const reason = required(input.reason, "Correction reason");
      const correctedCents = parseUsdCents(input.correctedAmount);
      const commandHash = await digest(
        JSON.stringify({
          piId,
          commandId,
          expectedVersion: input.expectedVersion,
          correctedCents,
          reason,
          actorId: actor.id,
        }),
      );
      const prior = await db
        .prepare(
          "SELECT command_hash FROM pi_payment_corrections WHERE command_id=?",
        )
        .bind(commandId)
        .first<{ command_hash: string }>();
      if (prior) {
        if (prior.command_hash !== commandHash) throw conflict();
        return this.read(actor, piId);
      }
      const before = await current(piId);
      if (
        !before.confirmation_id ||
        before.confirmation_valid !== 1 ||
        before.version !== input.expectedVersion
      )
        throw conflict();
      const id = crypto.randomUUID();
      const timestamp = now();
      const messageId = `payment-review:${id}`;
      const body = `Payment confirmation for ${before.document_number} is under review. Any confirmed order remains visible, but further release is on hold. Please contact Support for updates.`;
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO pi_payment_corrections(id,command_id,command_hash,pi_id,
          original_confirmation_id,previous_amount_cents,corrected_amount_cents,reason,actor_id,corrected_at)
          SELECT ?,?,?,pay.pi_id,c.id,pay.amount_received_cents,?,?,?,?
          FROM pi_payment_accounts pay JOIN pi_payment_confirmations c ON c.pi_id=pay.pi_id
          WHERE pay.pi_id=? AND pay.version=? AND pay.confirmation_valid=1`,
          )
          .bind(
            id,
            commandId,
            commandHash,
            correctedCents,
            reason,
            actor.id,
            timestamp,
            piId,
            input.expectedVersion,
          ),
        db
          .prepare(
            `UPDATE pi_payment_accounts SET amount_received_cents=?,confirmation_valid=0,
          version=version+1,updated_at=? WHERE pi_id=?
          AND EXISTS(SELECT 1 FROM pi_payment_corrections WHERE id=?)`,
          )
          .bind(correctedCents, timestamp, piId, id),
        db
          .prepare(
            `${impacted}
          INSERT INTO pi_payment_disputes(pi_id,correction_id,active,updated_at)
          SELECT pi_id,?,1,? FROM impacted WHERE pi_id IS NOT NULL
          ON CONFLICT(pi_id) DO UPDATE SET correction_id=excluded.correction_id,
            active=1,updated_at=excluded.updated_at`,
          )
          .bind(id, id, timestamp),
        db
          .prepare(
            `${impacted}
          INSERT INTO pi_order_hold_events(id,order_id,correction_id,kind,reason,actor_id,occurred_at)
          SELECT ?||':'||o.id,o.id,?,'hold',?,?,? FROM confirmed_orders o
          JOIN impacted i ON i.pi_id=o.pi_id
          ON CONFLICT(id) DO NOTHING`,
          )
          .bind(id, id, id, reason, actor.id, timestamp),
        db
          .prepare(
            `UPDATE order_release_guards SET held=1,review_event_id=?,updated_at=?
          WHERE order_id IN (SELECT order_id FROM pi_order_hold_events WHERE correction_id=? AND kind='hold')`,
          )
          .bind(id, timestamp, id),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'pi.payment_corrected','proforma_invoice',?,?,?,?
          WHERE EXISTS(SELECT 1 FROM pi_payment_corrections WHERE id=?)`,
          )
          .bind(
            `correction:${id}`,
            piId,
            actor.id,
            JSON.stringify({
              requestId: before.request_id,
              commandId: input.commandId,
              ipAddress: options.auditIp ?? null,
              prior: before.amount_received_cents,
              corrected: correctedCents,
              reason,
            }),
            timestamp,
            id,
          ),
        db
          .prepare(
            `INSERT INTO quote_conversations(request_id,created_at) SELECT ?,?
          WHERE EXISTS(SELECT 1 FROM pi_payment_corrections WHERE id=?)
          ON CONFLICT(request_id) DO NOTHING`,
          )
          .bind(before.request_id, timestamp, id),
        db
          .prepare(
            `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,
          created_at,command_id,payload_hash,source,delivery_state)
          SELECT ?,?,'admin',?,?,?, ?,?,'website','available'
          WHERE EXISTS(SELECT 1 FROM pi_payment_corrections WHERE id=?)`,
          )
          .bind(
            messageId,
            before.request_id,
            actor.id,
            body,
            timestamp,
            messageId,
            await digest(body),
            id,
          ),
        quoteNotificationOutboxStatement(db, {
          messageId,
          requestId: before.request_id,
          createdAt: timestamp,
        }),
      ]);
      if (results[0].meta.changes !== 1) throw conflict();
      return this.read(actor, piId);
    },
    async resolve(
      actor: AdminIdentity,
      input: {
        piId: string;
        commandId: string;
        correctionId: string;
        expectedVersion: number;
        reason: string;
        verificationReference: string;
      },
    ) {
      actorCheck(actor, true);
      const piId = required(input.piId, "PI id");
      const correctionId = required(input.correctionId, "Correction ID");
      const commandId = required(input.commandId, "Command ID");
      const reason = required(input.reason, "Owner review result");
      const reference = required(
        input.verificationReference,
        "Seller verification reference",
      );
      const commandHash = await digest(
        JSON.stringify({
          piId,
          correctionId,
          commandId,
          expectedVersion: input.expectedVersion,
          reason,
          reference,
          actorId: actor.id,
        }),
      );
      const prior = await db
        .prepare(
          "SELECT command_hash FROM pi_payment_correction_resolutions WHERE command_id=?",
        )
        .bind(commandId)
        .first<{ command_hash: string }>();
      if (prior) {
        if (prior.command_hash !== commandHash) throw conflict();
        return this.read(actor, piId);
      }
      const before = await current(piId);
      if (before.version !== input.expectedVersion) throw conflict();
      const active = await db
        .prepare(
          `SELECT 1 FROM pi_payment_disputes d
        JOIN pi_payment_corrections c ON c.id=d.correction_id
        WHERE c.id=? AND c.pi_id=? AND d.active=1 LIMIT 1`,
        )
        .bind(correctionId, piId)
        .first();
      if (!active) throw conflict();
      const deficit = await db
        .prepare(
          `${impacted}
        SELECT pay.pi_id FROM impacted i JOIN pi_payment_accounts pay ON pay.pi_id=i.pi_id
        LEFT JOIN confirmed_orders o ON o.pi_id=pay.pi_id
        LEFT JOIN order_change_financial_contract contract ON contract.order_id=o.id
        WHERE (i.pi_id=? AND pay.amount_received_cents<
          pay.allocated_out_cents+pay.refunded_cents+CASE WHEN o.id IS NULL THEN 0 ELSE
            pay.total_due_cents-coalesce(contract.authorized_credit_cents,0) END)
          OR (o.id IS NOT NULL AND
            pay.amount_received_cents+pay.allocated_in_cents-pay.allocated_out_cents-pay.refunded_cents<
              pay.total_due_cents-coalesce(contract.authorized_credit_cents,0))
        LIMIT 1`,
        )
        .bind(correctionId, piId)
        .first();
      if (deficit)
        throw new Response(
          "Disputed funds still leave a committed order or allocation short",
          { status: 409 },
        );
      const timestamp = now();
      const id = crypto.randomUUID();
      const messageId = `payment-review-resolved:${id}`;
      const body = `Payment review for ${before.document_number} is complete. View the current PI or Order in your account for the next step.`;
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO pi_payment_correction_resolutions(id,command_id,command_hash,
          correction_id,pi_id,reason,verification_reference,actor_id,resolved_at)
          SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pi_payment_disputes
            WHERE pi_id=? AND correction_id=? AND active=1)
          AND EXISTS(SELECT 1 FROM pi_payment_accounts WHERE pi_id=? AND version=?)
          AND NOT EXISTS(${impacted}
            SELECT 1 FROM impacted i JOIN pi_payment_accounts pay ON pay.pi_id=i.pi_id
            LEFT JOIN confirmed_orders o ON o.pi_id=pay.pi_id
            LEFT JOIN order_change_financial_contract contract ON contract.order_id=o.id
            WHERE (i.pi_id=? AND pay.amount_received_cents<
              pay.allocated_out_cents+pay.refunded_cents+
              CASE WHEN o.id IS NULL THEN 0 ELSE
                pay.total_due_cents-coalesce(contract.authorized_credit_cents,0) END)
              OR (o.id IS NOT NULL AND
                pay.amount_received_cents+pay.allocated_in_cents-pay.allocated_out_cents-pay.refunded_cents<
                  pay.total_due_cents-coalesce(contract.authorized_credit_cents,0)))`,
          )
          .bind(
            id,
            commandId,
            commandHash,
            correctionId,
            piId,
            reason,
            reference,
            actor.id,
            timestamp,
            piId,
            correctionId,
            piId,
            input.expectedVersion,
            correctionId,
            piId,
          ),
        db
          .prepare(
            `UPDATE pi_payment_accounts SET confirmation_valid=CASE WHEN EXISTS(
            SELECT 1 FROM confirmed_orders WHERE pi_id=?) THEN 1 ELSE 0 END,
          version=version+1,updated_at=? WHERE pi_id=?
          AND EXISTS(SELECT 1 FROM pi_payment_correction_resolutions WHERE id=?)`,
          )
          .bind(piId, timestamp, piId, id),
        db
          .prepare(
            `UPDATE pi_payment_disputes SET active=0,updated_at=?
          WHERE correction_id=? AND active=1 AND EXISTS(SELECT 1 FROM pi_payment_correction_resolutions WHERE id=?)`,
          )
          .bind(timestamp, correctionId, id),
        db
          .prepare(
            `INSERT INTO pi_order_hold_events(id,order_id,correction_id,kind,reason,actor_id,occurred_at)
          SELECT ?||':'||o.id,o.id,?,'release',?,?,?
          FROM confirmed_orders o JOIN pi_payment_disputes d ON d.pi_id=o.pi_id
          WHERE d.correction_id=? AND d.active=0
          ON CONFLICT(id) DO NOTHING`,
          )
          .bind(id, correctionId, reason, actor.id, timestamp, correctionId),
        db
          .prepare(
            `UPDATE order_release_guards SET held=0,review_event_id=?,updated_at=?
          WHERE order_id IN (SELECT order_id FROM pi_order_hold_events
            WHERE id LIKE ? AND kind='release')
          AND NOT EXISTS(SELECT 1 FROM pi_payment_disputes d
            JOIN confirmed_orders o ON o.pi_id=d.pi_id
            WHERE o.id=order_release_guards.order_id AND d.active=1)`,
          )
          .bind(id, timestamp, `${id}:%`),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'pi.payment_review_resolved','proforma_invoice',?,?,?,?
          WHERE EXISTS(SELECT 1 FROM pi_payment_correction_resolutions WHERE id=?)`,
          )
          .bind(
            `correction-resolved:${id}`,
            piId,
            actor.id,
            JSON.stringify({
              requestId: before.request_id,
              commandId: input.commandId,
              ipAddress: options.auditIp ?? null,
              correctionId,
              reason,
              reference,
            }),
            timestamp,
            id,
          ),
        db
          .prepare(
            `INSERT INTO quote_conversations(request_id,created_at) SELECT ?,?
          WHERE EXISTS(SELECT 1 FROM pi_payment_correction_resolutions WHERE id=?)
          ON CONFLICT(request_id) DO NOTHING`,
          )
          .bind(before.request_id, timestamp, id),
        db
          .prepare(
            `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,
          created_at,command_id,payload_hash,source,delivery_state)
          SELECT ?,?,'admin',?,?,?, ?,?,'website','available'
          WHERE EXISTS(SELECT 1 FROM pi_payment_correction_resolutions WHERE id=?)`,
          )
          .bind(
            messageId,
            before.request_id,
            actor.id,
            body,
            timestamp,
            messageId,
            await digest(body),
            id,
          ),
        quoteNotificationOutboxStatement(db, {
          messageId,
          requestId: before.request_id,
          createdAt: timestamp,
        }),
      ]);
      if (results[0].meta.changes !== 1) throw conflict();
      return this.read(actor, piId);
    },
  };
}
