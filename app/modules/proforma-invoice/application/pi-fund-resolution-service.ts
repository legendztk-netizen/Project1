import type { AdminIdentity } from "#workers/admin-access";
import {
  effectiveQuoteAgreementSql,
  unspecifiedPaymentDeadlineSql,
} from "../infrastructure/accepted-agreement-sql";
import { piSha256 } from "../domain/proforma-invoice";
import { parseUsdCents } from "./pi-payment-service";
import { orderCreationStatements } from "../infrastructure/d1-order-creation";
import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";

interface Account {
  pi_id: string;
  request_id: string;
  document_number: string;
  purchasing_context_id: string;
  currency: "USD";
  total_due_cents: number;
  amount_received_cents: number;
  allocated_in_cents: number;
  allocated_out_cents: number;
  refunded_cents: number;
  actual_channel: "bank_transfer" | "paypal" | null;
  receipt_history_known: number;
  version: number;
  confirmed: number;
  current_pi_id: string | null;
  authorized_credit_cents: number;
  uninitiated_refund_cents: number;
}

const digest = (value: string) => piSha256(new TextEncoder().encode(value));
const conflict = () =>
  new Response("Funds or PI changed; reload and review", { status: 409 });
function required(value: string, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 1000)
    throw new Response(`${label} required`, { status: 400 });
  return value.trim();
}
function checkActor(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}
function uuid(value: string) {
  if (!/^[0-9a-f-]{36}$/i.test(value))
    throw new Response("Valid command ID required", { status: 400 });
  return value;
}
function available(row: Account) {
  return Math.max(
    0,
    row.amount_received_cents +
      row.allocated_in_cents -
      row.allocated_out_cents -
      row.refunded_cents -
      (row.confirmed ? row.total_due_cents : 0) -
      row.uninitiated_refund_cents,
  );
}
function shortfall(row: Account) {
  return Math.max(
    0,
    row.total_due_cents -
      row.authorized_credit_cents -
      row.amount_received_cents -
      row.allocated_in_cents +
      row.allocated_out_cents +
      row.refunded_cents,
  );
}

export function createPiFundResolutionService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  async function account(piId: string) {
    const row = await db
      .prepare(
        `SELECT pay.*,p.document_number,
      (SELECT pi_id FROM proforma_invoice_heads WHERE request_id=p.request_id) AS current_pi_id,
      EXISTS(SELECT 1 FROM pi_payment_confirmations WHERE pi_id=p.id) AS confirmed,
      coalesce(contract.authorized_credit_cents,0) AS authorized_credit_cents,
      coalesce(contract.uninitiated_refund_cents,0) AS uninitiated_refund_cents
      FROM pi_payment_accounts pay JOIN proforma_invoices p ON p.id=pay.pi_id
      LEFT JOIN order_change_financial_contract contract ON contract.pi_id=pay.pi_id
      WHERE pay.pi_id=?`,
      )
      .bind(required(piId, "PI id"))
      .first<Account>();
    if (!row) throw new Response("PI not found", { status: 404 });
    return row;
  }
  async function replay(commandId: string, commandHash: string) {
    const row = await db
      .prepare(
        "SELECT command_hash FROM pi_fund_resolutions WHERE command_id=?",
      )
      .bind(commandId)
      .first<{ command_hash: string }>();
    if (row && row.command_hash !== commandHash) throw conflict();
    return !!row;
  }
  function notification(
    messageId: string,
    requestId: string,
    actorId: string,
    body: string,
    timestamp: string,
    resolutionId: string,
    messageHash: string,
    kind: "fund" | "original_currency" = "fund",
  ) {
    const resolutionTable =
      kind === "fund" ? "pi_fund_resolutions" : "pi_original_currency_refunds";
    return [
      db
        .prepare(
          `INSERT INTO quote_conversations(request_id,created_at)
        SELECT ?,? WHERE EXISTS(SELECT 1 FROM ${resolutionTable} WHERE id=?)
        ON CONFLICT(request_id) DO NOTHING`,
        )
        .bind(requestId, timestamp, resolutionId),
      db
        .prepare(
          `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,
        created_at,command_id,payload_hash,source,delivery_state)
        SELECT ?,?,'admin',?,?,?, ?,?,'website','available'
        WHERE EXISTS(SELECT 1 FROM ${resolutionTable} WHERE id=?)
        ON CONFLICT(command_id) DO NOTHING`,
        )
        .bind(
          messageId,
          requestId,
          actorId,
          body,
          timestamp,
          messageId,
          messageHash,
          resolutionId,
        ),
      quoteNotificationOutboxStatement(db, {
        messageId,
        requestId,
        createdAt: timestamp,
      }),
    ];
  }
  return {
    async read(actor: AdminIdentity, piId: string) {
      checkActor(actor);
      const row = await account(piId);
      const resolutions = (
        await db
          .prepare(
            `SELECT id,kind,source_pi_id AS sourcePiId,
        target_pi_id AS targetPiId,amount_cents AS amountCents,currency,resolved_at AS resolvedAt
        FROM pi_fund_resolutions WHERE source_pi_id=? OR target_pi_id=?
        ORDER BY resolved_at DESC,id DESC`,
          )
          .bind(piId, piId)
          .all()
      ).results;
      return {
        piId,
        documentNumber: row.document_number,
        currency: row.currency,
        version: row.version,
        current: row.current_pi_id === piId,
        availableCents: available(row),
        shortfallCents: shortfall(row),
        receivedCents: row.amount_received_cents,
        allocatedInCents: row.allocated_in_cents,
        allocatedOutCents: row.allocated_out_cents,
        refundedCents: row.refunded_cents,
        resolutions,
      };
    },
    async allocate(
      actor: AdminIdentity,
      input: {
        sourcePiId: string;
        targetPiId: string;
        commandId: string;
        sourceVersion: number;
        targetVersion: number;
        amount: string;
        customerAuthorization: string;
        externalReference: string;
      },
    ) {
      checkActor(actor);
      const sourcePiId = required(input.sourcePiId, "Source PI");
      const targetPiId = required(input.targetPiId, "Target PI");
      if (sourcePiId === targetPiId)
        throw new Response("Choose a different target PI", { status: 400 });
      const commandId = uuid(input.commandId);
      const amountCents = parseUsdCents(input.amount);
      if (!amountCents)
        throw new Response("Allocation amount must be positive", {
          status: 400,
        });
      const authorization = required(
        input.customerAuthorization,
        "Verified customer authorization",
      );
      const reference = required(
        input.externalReference,
        "Authorization reference",
      );
      const commandHash = await digest(
        JSON.stringify({
          sourcePiId,
          targetPiId,
          commandId,
          sourceVersion: input.sourceVersion,
          targetVersion: input.targetVersion,
          amountCents,
          authorization,
          reference,
          actorId: actor.id,
        }),
      );
      if (await replay(commandId, commandHash))
        return this.read(actor, sourcePiId);
      const [source, target] = await Promise.all([
        account(sourcePiId),
        account(targetPiId),
      ]);
      if (
        source.version !== input.sourceVersion ||
        target.version !== input.targetVersion ||
        source.purchasing_context_id !== target.purchasing_context_id ||
        source.currency !== target.currency ||
        source.receipt_history_known !== 1 ||
        target.receipt_history_known !== 1 ||
        !source.actual_channel ||
        available(source) < amountCents ||
        shortfall(target) < amountCents ||
        target.current_pi_id !== targetPiId
      )
        throw conflict();
      const timestamp = now();
      const id = crypto.randomUUID();
      const messageId = `fund-allocation:${id}`;
      const message = `USD ${(amountCents / 100).toFixed(2)} in verified funds from ${source.document_number} was applied to ${target.document_number}. Review the current PI in My Quotes.`;
      const orderStatements = await orderCreationStatements(db, {
        piId: targetPiId,
        requestId: target.request_id,
        now: timestamp,
        finalEvent: "payment",
      });
      let results: D1Result[];
      try {
        results = await db.batch([
          db
            .prepare(
              `INSERT INTO pi_fund_resolutions(id,command_id,command_hash,kind,source_pi_id,
            target_pi_id,amount_cents,currency,source_version,target_version,customer_authorization,
            external_reference,original_channel,actor_id,resolved_at)
            VALUES(?,?,?,'allocation',?,? ,?,'USD',?,?,?,?,?,?,?)`,
            )
            .bind(
              id,
              commandId,
              commandHash,
              sourcePiId,
              targetPiId,
              amountCents,
              input.sourceVersion,
              input.targetVersion,
              authorization,
              reference,
              source.actual_channel,
              actor.id,
              timestamp,
            ),
          db
            .prepare(
              `UPDATE pi_payment_accounts SET allocated_out_cents=allocated_out_cents+?,
            version=version+1,updated_at=? WHERE pi_id=?`,
            )
            .bind(amountCents, timestamp, sourcePiId),
          db
            .prepare(
              `UPDATE pi_payment_accounts SET allocated_in_cents=allocated_in_cents+?,
            actual_channel=COALESCE(actual_channel,?),version=version+1,updated_at=? WHERE pi_id=?`,
            )
            .bind(amountCents, source.actual_channel, timestamp, targetPiId),
          db
            .prepare(
              `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
            VALUES(?,'pi.funds_allocated','proforma_invoice',?,?,?,?)`,
            )
            .bind(
              `allocation:${id}`,
              targetPiId,
              actor.id,
              JSON.stringify({
                requestId: target.request_id,
                commandId,
                ipAddress: options.auditIp ?? null,
                sourcePiId,
                targetPiId,
                amountCents,
                authorization,
                reference,
              }),
              timestamp,
            ),
          db
            .prepare(
              `INSERT INTO pi_payment_confirmations(id,command_id,command_hash,pi_id,
            confirmed_cents,currency,actual_channel,external_reference,actor_id,confirmed_at)
            SELECT ?,?,?,pay.pi_id,pay.total_due_cents,'USD',pay.actual_channel,?,?,?
            FROM pi_payment_accounts pay JOIN proforma_invoices p ON p.id=pay.pi_id
            JOIN proforma_invoice_heads head ON head.pi_id=p.id
            JOIN quote_revisions q ON q.id=p.quote_revision_id
            WHERE pay.pi_id=? AND pay.total_due_cents>0 AND pay.late_review_required=0
              AND pay.amount_received_cents+pay.allocated_in_cents-pay.allocated_out_cents-pay.refunded_cents>=pay.total_due_cents
              AND pay.actual_channel IS NOT NULL AND (pay.due_at>=? OR ${unspecifiedPaymentDeadlineSql("p")})
              AND EXISTS(SELECT 1 FROM pi_acceptances a WHERE a.pi_id=p.id
                AND a.document_version=p.document_version AND a.snapshot_hash=p.snapshot_hash
                AND a.quote_revision_id=p.quote_revision_id)
              AND ${effectiveQuoteAgreementSql("p")}
              AND (NOT EXISTS(SELECT 1 FROM json_each(p.snapshot_json,'$.lines') line
                WHERE json_extract(line.value,'$.madeToOrder')=1)
                OR json_extract(q.snapshot_json,'$.factoryReviewConfirmed')=1)
              AND EXISTS(SELECT 1 FROM pi_fund_resolutions WHERE id=?)
            ON CONFLICT(pi_id) DO NOTHING`,
            )
            .bind(
              `allocation-confirm:${id}`,
              `allocation-confirm:${commandId}`,
              commandHash,
              reference,
              actor.id,
              timestamp,
              targetPiId,
              timestamp,
              id,
            ),
          ...orderStatements,
          ...notification(
            messageId,
            target.request_id,
            actor.id,
            message,
            timestamp,
            id,
            await digest(message),
          ),
        ]);
      } catch (error) {
        if (
          String(error).includes("Source funds unavailable") ||
          String(error).includes("Target PI unavailable")
        )
          throw conflict();
        if (await replay(commandId, commandHash))
          return this.read(actor, sourcePiId);
        throw error;
      }
      if (results[0].meta.changes !== 1) throw conflict();
      return this.read(actor, sourcePiId);
    },
    async recordRefund(
      actor: AdminIdentity,
      input: {
        piId: string;
        commandId: string;
        expectedVersion: number;
        amount: string;
        customerAuthorization: string;
        externalReference: string;
      },
    ) {
      checkActor(actor);
      const piId = required(input.piId, "PI id");
      const commandId = uuid(input.commandId);
      const amountCents = parseUsdCents(input.amount);
      if (!amountCents)
        throw new Response("Refund amount must be positive", { status: 400 });
      const authorization = required(
        input.customerAuthorization,
        "Verified customer authorization",
      );
      const reference = required(
        input.externalReference,
        "Completed external refund reference",
      );
      const commandHash = await digest(
        JSON.stringify({
          piId,
          commandId,
          expectedVersion: input.expectedVersion,
          amountCents,
          authorization,
          reference,
          actorId: actor.id,
        }),
      );
      if (await replay(commandId, commandHash)) return this.read(actor, piId);
      const source = await account(piId);
      if (
        source.version !== input.expectedVersion ||
        !source.actual_channel ||
        source.receipt_history_known !== 1 ||
        available(source) < amountCents
      )
        throw conflict();
      const timestamp = now();
      const id = crypto.randomUUID();
      const messageId = `external-refund:${id}`;
      const body = `An external refund of USD ${(amountCents / 100).toFixed(2)} associated with ${source.document_number} has been recorded. Contact Support with questions.`;
      let results: D1Result[];
      try {
        results = await db.batch([
          db
            .prepare(
              `INSERT INTO pi_fund_resolutions(id,command_id,command_hash,kind,source_pi_id,
            target_pi_id,amount_cents,currency,source_version,target_version,customer_authorization,
            external_reference,original_channel,actor_id,resolved_at)
            VALUES(?,?,?,'external_refund',?,NULL,?,'USD',?,NULL,?,?,?,?,?)`,
            )
            .bind(
              id,
              commandId,
              commandHash,
              piId,
              amountCents,
              input.expectedVersion,
              authorization,
              reference,
              source.actual_channel,
              actor.id,
              timestamp,
            ),
          db
            .prepare(
              `UPDATE pi_payment_accounts SET refunded_cents=refunded_cents+?,
            version=version+1,updated_at=? WHERE pi_id=?`,
            )
            .bind(amountCents, timestamp, piId),
          db
            .prepare(
              `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
            VALUES(?,'pi.external_refund_recorded','proforma_invoice',?,?,?,?)`,
            )
            .bind(
              `refund:${id}`,
              piId,
              actor.id,
              JSON.stringify({
                requestId: source.request_id,
                commandId,
                ipAddress: options.auditIp ?? null,
                amountCents,
                reference,
                authorization,
              }),
              timestamp,
            ),
          ...notification(
            messageId,
            source.request_id,
            actor.id,
            body,
            timestamp,
            id,
            await digest(body),
          ),
        ]);
      } catch (error) {
        if (String(error).includes("Source funds unavailable"))
          throw conflict();
        if (await replay(commandId, commandHash)) return this.read(actor, piId);
        throw error;
      }
      if (results[0].meta.changes !== 1) throw conflict();
      return this.read(actor, piId);
    },
    async refundOriginalCurrency(
      actor: AdminIdentity,
      input: {
        piId: string;
        receiptId: string;
        commandId: string;
        amount: string;
        customerAuthorization: string;
        externalReference: string;
      },
    ) {
      checkActor(actor);
      const receiptId = required(input.receiptId, "Original-currency receipt");
      const commandId = uuid(input.commandId);
      const authorization = required(
        input.customerAuthorization,
        "Verified customer authorization",
      );
      const reference = required(
        input.externalReference,
        "Completed external refund reference",
      );
      const receipt = await db
        .prepare(
          `SELECT r.pi_id,r.currency,b.currency_digits,b.amount_minor,b.refunded_minor,
        p.request_id,p.document_number
        FROM pi_original_currency_receipts r JOIN pi_original_currency_receipt_balances b ON b.receipt_id=r.id
        JOIN proforma_invoices p ON p.id=r.pi_id
        WHERE r.id=? AND r.pi_id=?`,
        )
        .bind(receiptId, required(input.piId, "Source PI"))
        .first<{
          pi_id: string;
          currency: string;
          currency_digits: number;
          amount_minor: number;
          refunded_minor: number;
          request_id: string;
          document_number: string;
        }>();
      if (!receipt)
        throw new Response("Original-currency receipt requires manual review", {
          status: 409,
        });
      const regex = receipt.currency_digits
        ? new RegExp(
            `^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,${receipt.currency_digits}})?$`,
          )
        : /^(?:0|[1-9]\d{0,11})$/;
      if (!regex.test(input.amount))
        throw new Response("Invalid original-currency amount", { status: 400 });
      const [whole, decimal = ""] = input.amount.split(".");
      const minor =
        Number(whole) * 10 ** receipt.currency_digits +
        Number(decimal.padEnd(receipt.currency_digits, "0"));
      if (!Number.isSafeInteger(minor) || minor <= 0) throw conflict();
      const commandHash = await digest(
        JSON.stringify({
          receiptId,
          commandId,
          minor,
          authorization,
          reference,
          actorId: actor.id,
        }),
      );
      const prior = await db
        .prepare(
          "SELECT command_hash FROM pi_original_currency_refunds WHERE command_id=?",
        )
        .bind(commandId)
        .first<{ command_hash: string }>();
      if (prior) {
        if (prior.command_hash !== commandHash) throw conflict();
        return { recorded: true as const };
      }
      if (minor > receipt.amount_minor - receipt.refunded_minor)
        throw conflict();
      const id = crypto.randomUUID();
      const timestamp = now();
      const messageId = `original-currency-refund:${id}`;
      const body = `An external refund of ${receipt.currency} ${input.amount} associated with ${receipt.document_number} has been recorded. Contact Support with questions.`;
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO pi_original_currency_refunds(id,command_id,command_hash,receipt_id,
            amount_minor,currency,customer_authorization,external_reference,actor_id,refunded_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              id,
              commandId,
              commandHash,
              receiptId,
              minor,
              receipt.currency,
              authorization,
              reference,
              actor.id,
              timestamp,
            ),
          db
            .prepare(
              `UPDATE pi_original_currency_receipt_balances SET refunded_minor=refunded_minor+?,
            version=version+1 WHERE receipt_id=?`,
            )
            .bind(minor, receiptId),
          db
            .prepare(
              `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
            VALUES(?,'pi.original_currency_refund_recorded','proforma_invoice',?,?,?,?)`,
            )
            .bind(
              `foreign-refund:${id}`,
              receipt.pi_id,
              actor.id,
              JSON.stringify({
                requestId: receipt.request_id,
                commandId,
                ipAddress: options.auditIp ?? null,
                receiptId,
                minor,
                currency: receipt.currency,
                reference,
              }),
              timestamp,
            ),
          ...notification(
            messageId,
            receipt.request_id,
            actor.id,
            body,
            timestamp,
            id,
            await digest(body),
            "original_currency",
          ),
        ]);
      } catch (error) {
        if (String(error).includes("Original-currency receipt unavailable"))
          throw conflict();
        throw error;
      }
      return { recorded: true as const };
    },
  };
}
