import type { AdminIdentity } from "#workers/admin-access";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import { piSha256 } from "../domain/proforma-invoice";
import type { PaymentChannel } from "../../seller-settings/domain/seller-commercial-settings";
import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";
import { orderCreationStatements } from "../infrastructure/d1-order-creation";

export interface PiPaymentAccount {
  pi_id: string;
  request_id: string;
  purchasing_context_id: string;
  currency: "USD";
  total_due_cents: number;
  term_kind: "ten_us_business_days" | "fixed_et_date" | "legacy_review";
  calendar_version: string | null;
  due_date_et: string | null;
  due_at: string | null;
  late_review_required: number;
  amount_received_cents: number;
  allocated_in_cents: number;
  allocated_out_cents: number;
  refunded_cents: number;
  confirmation_valid: number;
  actual_channel: PaymentChannel | null;
  ever_received: number;
  instruction_channel: PaymentChannel;
  instruction_id: string;
  instruction_version: number;
  version: number;
  receipt_history_known: number;
  document_number: string;
  buyer_name: string;
  accepted_at: string | null;
  current_pi_id: string | null;
  confirmation_id: string | null;
  order_id: string | null;
}

export interface UpdateReceivedAmount {
  piId: string;
  commandId: string;
  expectedVersion: number;
  amount: string;
  currency: string;
  actualChannel: PaymentChannel;
  verificationReference: string;
  receivedInstructionId?: string;
  reason?: string;
}
export interface ChangePiInstructions {
  piId: string;
  commandId: string;
  expectedVersion: number;
  instructionId: string;
  instructionVersion: number;
  channel: PaymentChannel;
  reason: string;
}
export interface RecordOriginalCurrencyReceipt {
  piId: string;
  commandId: string;
  currency: string;
  amount: string;
  actualChannel: PaymentChannel;
  verificationReference: string;
}
export interface ConfirmPiPayment {
  piId: string;
  commandId: string;
  expectedVersion: number;
  externallyVerified: boolean;
  externalReference: string;
}

const conflict = () =>
  new Response("Payment changed; reload and review", { status: 409 });
const sha = (value: string) => piSha256(new TextEncoder().encode(value));
function required(value: string, label: string, max = 1000) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Response(`${label} required`, { status: 400 });
  return value.trim();
}
function admin(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}
export function parseUsdCents(value: string) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)
  )
    throw new Response(
      "Enter a nonnegative USD amount with at most two decimals",
      { status: 400 },
    );
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents))
    throw new Response("USD amount exceeds supported precision", {
      status: 400,
    });
  return cents;
}
function channel(value: string): PaymentChannel {
  if (value !== "bank_transfer" && value !== "paypal")
    throw new Response("Actual payment channel required", { status: 400 });
  return value;
}
function projection(row: PiPaymentAccount) {
  const effectiveCents =
    row.amount_received_cents +
    row.allocated_in_cents -
    row.allocated_out_cents -
    row.refunded_cents;
  return {
    piId: row.pi_id,
    requestId: row.request_id,
    documentNumber: row.document_number,
    currency: row.currency,
    totalDueCents: row.total_due_cents,
    amountReceivedCents: row.amount_received_cents,
    allocatedInCents: row.allocated_in_cents,
    allocatedOutCents: row.allocated_out_cents,
    refundedCents: row.refunded_cents,
    applicableCents: effectiveCents,
    balanceCents: Math.max(0, row.total_due_cents - effectiveCents),
    excessCents: Math.max(0, effectiveCents - row.total_due_cents),
    dueDateEt: row.due_date_et,
    dueAt: row.due_at,
    termKind: row.term_kind,
    acceptedAt: row.accepted_at,
    current: row.current_pi_id === row.pi_id,
    actualChannel: row.actual_channel,
    instructionChannel: row.instruction_channel,
    instructionId: row.instruction_id,
    instructionVersion: row.instruction_version,
    version: row.version,
    receiptHistoryKnown: row.receipt_history_known === 1,
    // A cumulative receipt is not Cleared Funds and never means an Order exists.
    paymentConfirmed:
      row.confirmation_id !== null && row.confirmation_valid === 1,
    orderId: row.order_id,
  };
}

export function createPiPaymentService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const accountSql = `SELECT a.*,p.document_number,
    COALESCE(NULLIF(json_extract(p.snapshot_json,'$.buyer.legalName'),''),
      NULLIF(json_extract(p.snapshot_json,'$.buyer.contactName'),''),
      (SELECT profile.email_display FROM customer_profiles profile
        JOIN customer_quote_requests request ON request.profile_id=profile.id
        WHERE request.id=p.request_id)) AS buyer_name,
    (SELECT accepted_at FROM pi_acceptances WHERE pi_id=p.id) AS accepted_at,
    (SELECT pi_id FROM proforma_invoice_heads WHERE request_id=p.request_id) AS current_pi_id,
    (SELECT id FROM pi_payment_confirmations WHERE pi_id=p.id) AS confirmation_id,
    (SELECT id FROM confirmed_orders WHERE pi_id=p.id) AS order_id
    FROM pi_payment_accounts a JOIN proforma_invoices p ON p.id=a.pi_id WHERE a.pi_id=?`;
  async function account(piId: string) {
    const row = await db
      .prepare(accountSql)
      .bind(required(piId, "PI id"))
      .first<PiPaymentAccount>();
    if (!row)
      throw new Response("PI payment account not found", { status: 404 });
    return row;
  }
  async function replay(commandId: string, piId: string, hash: string) {
    const event = await db
      .prepare(
        "SELECT pi_id,command_hash FROM pi_payment_events WHERE command_id=?",
      )
      .bind(commandId)
      .first<{ pi_id: string; command_hash: string }>();
    if (!event) return false;
    if (event.pi_id !== piId || event.command_hash !== hash) throw conflict();
    return true;
  }
  async function confirmedOrder(piId: string) {
    return db
      .prepare(
        "SELECT id,order_number AS orderNumber FROM confirmed_orders WHERE pi_id=?",
      )
      .bind(piId)
      .first<{ id: string; orderNumber: string }>();
  }
  return {
    async adminRead(actor: AdminIdentity, piId: string) {
      admin(actor);
      const row = await account(piId);
      const originalCurrencyReceipts = (
        await db
          .prepare(
            `SELECT r.id,r.currency,r.amount_decimal AS amount,r.actual_channel AS actualChannel,
          r.recorded_at AS recordedAt,b.amount_minor AS amountMinor,b.refunded_minor AS refundedMinor,
          b.currency_digits AS currencyDigits
          FROM pi_original_currency_receipts r
          LEFT JOIN pi_original_currency_receipt_balances b ON b.receipt_id=r.id
          WHERE r.pi_id=? ORDER BY r.recorded_at DESC,r.id DESC`,
          )
          .bind(piId)
          .all<{
            id: string;
            currency: string;
            amount: string;
            actualChannel: PaymentChannel;
            recordedAt: string;
            amountMinor: number | null;
            refundedMinor: number | null;
            currencyDigits: number | null;
          }>()
      ).results;
      const receiptInstructionHistory = (
        await db
          .prepare(
            `SELECT e.id,e.occurred_at AS occurredAt,e.new_amount_cents AS cumulativeCents,
            v.channel,v.version,v.status
           FROM pi_payment_events e
           LEFT JOIN seller_payment_instruction_versions v ON v.id=e.received_instruction_id
           WHERE e.pi_id=? AND e.kind='amount_received'
           ORDER BY e.occurred_at DESC,e.id DESC`,
          )
          .bind(piId)
          .all<{
            id: string;
            occurredAt: string;
            cumulativeCents: number;
            channel: string | null;
            version: number | null;
            status: string | null;
          }>()
      ).results;
      return {
        ...projection(row),
        buyerName: row.buyer_name,
        originalCurrencyReceipts,
        receiptInstructionHistory,
      };
    },
    async customerRead(profileId: string, requestId: string, piId: string) {
      required(profileId, "Customer profile");
      const owned = await db
        .prepare(
          `SELECT a.pi_id FROM pi_payment_accounts a JOIN customer_quote_requests request ON request.id=a.request_id
           ${ownedQuoteRequestWhere} AND request.id=? AND a.pi_id=?`,
        )
        .bind(profileId, profileId, profileId, requestId, piId)
        .first();
      if (!owned) throw new Response("Not found", { status: 404 });
      return projection(await account(piId));
    },
    async updateReceived(actor: AdminIdentity, input: UpdateReceivedAmount) {
      admin(actor);
      const piId = required(input.piId, "PI id");
      const commandId = required(input.commandId, "Command id", 100);
      if (!/^[0-9a-f-]{36}$/i.test(commandId))
        throw new Response("Valid command id required", { status: 400 });
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1
      )
        throw new Response("Payment version required", { status: 400 });
      if (input.currency !== "USD")
        throw new Response(
          "Non-USD receipts require original-currency review",
          { status: 409 },
        );
      const cents = parseUsdCents(input.amount);
      const actualChannel = channel(input.actualChannel);
      const reference = required(
        input.verificationReference,
        "External verification reference",
      );
      const reason = input.reason?.trim() ?? "";
      const hash = await sha(
        JSON.stringify({
          piId,
          actorId: actor.id,
          expectedVersion: input.expectedVersion,
          cents,
          currency: "USD",
          actualChannel,
          receivedInstructionId: input.receivedInstructionId ?? null,
          reference,
          reason,
        }),
      );
      if (await replay(commandId, piId, hash))
        return projection(await account(piId));
      const before = await account(piId);
      const receivedInstruction = await db
        .prepare(
          `SELECT id FROM seller_payment_instruction_versions
           WHERE channel=? AND (? IS NULL OR id=?)
           ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,version DESC LIMIT 1`,
        )
        .bind(
          actualChannel,
          input.receivedInstructionId ?? null,
          input.receivedInstructionId ?? null,
          before.instruction_id,
        )
        .first<{ id: string }>();
      if (!receivedInstruction)
        throw new Response(
          "Receipt instruction version does not match the actual channel",
          { status: 400 },
        );
      const receivedInstructionId = receivedInstruction.id;
      if (before.version !== input.expectedVersion) throw conflict();
      if (before.confirmation_id && before.confirmation_valid === 1)
        throw new Response(
          "Confirmed payment requires the correction workflow",
          { status: 409 },
        );
      if (cents === before.amount_received_cents)
        throw new Response("Received amount has not changed", { status: 400 });
      if (cents < before.amount_received_cents && !reason)
        throw new Response("A reason is required for a downward correction", {
          status: 400,
        });
      if (
        cents + before.allocated_in_cents <
        before.allocated_out_cents + before.refunded_cents
      )
        throw new Response(
          "Resolve posted allocations/refunds before reducing source funds",
          { status: 409 },
        );
      const occurredAt = now();
      const eventId = crypto.randomUUID();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE pi_payment_accounts SET amount_received_cents=?,actual_channel=?,
           ever_received=CASE WHEN ? > 0 THEN 1 ELSE ever_received END,
           receipt_history_known=1,version=version+1,updated_at=? WHERE pi_id=? AND version=? AND amount_received_cents=?
           AND ? + allocated_in_cents >= allocated_out_cents+refunded_cents
           AND (confirmation_valid=0 OR NOT EXISTS(SELECT 1 FROM pi_payment_confirmations WHERE pi_id=pi_payment_accounts.pi_id))`,
          )
          .bind(
            cents,
            actualChannel,
            cents,
            occurredAt,
            piId,
            input.expectedVersion,
            before.amount_received_cents,
            cents,
          ),
        db
          .prepare(
            `INSERT INTO pi_payment_events(id,command_id,command_hash,pi_id,kind,previous_version,next_version,
           previous_amount_cents,new_amount_cents,currency,actual_channel,reason,actor_id,occurred_at,payload_json,received_instruction_id)
           SELECT ?,?, ?,pi_id,'amount_received',?,version,?,?, 'USD',?,?,?, ?,?,?
           FROM pi_payment_accounts WHERE pi_id=? AND changes()=1`,
          )
          .bind(
            eventId,
            commandId,
            hash,
            input.expectedVersion,
            before.receipt_history_known ? before.amount_received_cents : null,
            cents,
            actualChannel,
            reason || null,
            actor.id,
            occurredAt,
            JSON.stringify({
              verificationReference: reference,
              basis: "externally_verified_settled_amount",
            }),
            receivedInstructionId,
            piId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
           SELECT ?,'pi.amount_received_updated','proforma_invoice',?,?,?,?
           WHERE EXISTS(SELECT 1 FROM pi_payment_events WHERE id=?)`,
          )
          .bind(
            `payment:${eventId}`,
            piId,
            actor.id,
            JSON.stringify({
              previousCents: before.receipt_history_known
                ? before.amount_received_cents
                : null,
              newCents: cents,
              actualChannel,
              requestId: before.request_id,
              commandId,
              ipAddress: options.auditIp ?? null,
              receivedInstructionId,
            }),
            occurredAt,
            eventId,
          ),
      ]);
      if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
        if (await replay(commandId, piId, hash))
          return projection(await account(piId));
        throw conflict();
      }
      return projection(await account(piId));
    },
    async changeInstructions(
      actor: AdminIdentity,
      input: ChangePiInstructions,
    ) {
      admin(actor);
      const piId = required(input.piId, "PI id");
      const commandId = required(input.commandId, "Command id", 100);
      const instructionId = required(
        input.instructionId,
        "Payment instructions",
      );
      const reason = required(input.reason, "Change reason");
      if (!/^[0-9a-f-]{36}$/i.test(commandId))
        throw new Response("Valid command id required", { status: 400 });
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1 ||
        !Number.isSafeInteger(input.instructionVersion) ||
        input.instructionVersion < 1
      )
        throw new Response("Explicit versions required", { status: 400 });
      const selectedChannel = channel(input.channel);
      const hash = await sha(
        JSON.stringify({
          piId,
          actorId: actor.id,
          expectedVersion: input.expectedVersion,
          instructionId,
          instructionVersion: input.instructionVersion,
          selectedChannel,
          reason,
        }),
      );
      if (await replay(commandId, piId, hash))
        return projection(await account(piId));
      const before = await account(piId);
      if (
        before.version !== input.expectedVersion ||
        before.current_pi_id !== piId ||
        !before.receipt_history_known ||
        before.ever_received ||
        before.amount_received_cents !== 0
      )
        throw conflict();
      if (before.instruction_id === instructionId)
        throw new Response("Instructions have not changed", { status: 400 });
      const occurredAt = now();
      const eventId = crypto.randomUUID();
      const messageId = `pi-instructions:${eventId}`;
      const body = `Payment instructions for ${before.document_number} have changed. Please use the current payment instructions in My Quotes before sending payment.`;
      const results = await db.batch([
        db
          .prepare(
            `UPDATE pi_payment_accounts SET instruction_channel=?,instruction_id=?,instruction_version=?,
           version=version+1,updated_at=? WHERE pi_id=? AND version=? AND receipt_history_known=1 AND ever_received=0
           AND amount_received_cents=0 AND EXISTS(SELECT 1 FROM proforma_invoice_heads WHERE pi_id=?)
           AND EXISTS(SELECT 1 FROM seller_payment_instruction_versions WHERE id=? AND version=?
             AND channel=? AND status='current')`,
          )
          .bind(
            selectedChannel,
            instructionId,
            input.instructionVersion,
            occurredAt,
            piId,
            input.expectedVersion,
            piId,
            instructionId,
            input.instructionVersion,
            selectedChannel,
          ),
        db
          .prepare(
            `INSERT INTO pi_payment_events(id,command_id,command_hash,pi_id,kind,previous_version,next_version,
           old_instruction_id,new_instruction_id,reason,actor_id,occurred_at,payload_json)
           SELECT ?,?,?,pi_id,'instruction_changed',?,version,?,?,?,?,?,?
           FROM pi_payment_accounts WHERE pi_id=? AND changes()=1`,
          )
          .bind(
            eventId,
            commandId,
            hash,
            input.expectedVersion,
            before.instruction_id,
            instructionId,
            reason,
            actor.id,
            occurredAt,
            JSON.stringify({
              oldChannel: before.instruction_channel,
              newChannel: selectedChannel,
              oldVersion: before.instruction_version,
              newVersion: input.instructionVersion,
            }),
            piId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
           SELECT ?,'pi.instructions_changed','proforma_invoice',?,?,?,?
           WHERE EXISTS(SELECT 1 FROM pi_payment_events WHERE id=?)`,
          )
          .bind(
            `payment:${eventId}`,
            piId,
            actor.id,
            JSON.stringify({
              requestId: before.request_id,
              commandId,
              ipAddress: options.auditIp ?? null,
              oldInstructionId: before.instruction_id,
              newInstructionId: instructionId,
            }),
            occurredAt,
            eventId,
          ),
        db
          .prepare(
            `INSERT INTO quote_conversations(request_id,created_at)
           SELECT request_id,? FROM pi_payment_accounts WHERE pi_id=?
           AND EXISTS(SELECT 1 FROM pi_payment_events WHERE id=?)
           ON CONFLICT(request_id) DO NOTHING`,
          )
          .bind(occurredAt, piId, eventId),
        db
          .prepare(
            `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,created_at,
           command_id,payload_hash,source,delivery_state)
           SELECT ?,request_id,'admin',?,?,?, ?,?,'website','available'
           FROM pi_payment_accounts WHERE pi_id=? AND EXISTS(SELECT 1 FROM pi_payment_events WHERE id=?)`,
          )
          .bind(
            messageId,
            actor.id,
            body,
            occurredAt,
            messageId,
            await sha(body),
            piId,
            eventId,
          ),
        quoteNotificationOutboxStatement(db, {
          messageId,
          requestId: before.request_id,
          createdAt: occurredAt,
        }),
      ]);
      if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
        if (await replay(commandId, piId, hash))
          return projection(await account(piId));
        throw conflict();
      }
      return projection(await account(piId));
    },
    async recordOriginalCurrencyReceipt(
      actor: AdminIdentity,
      input: RecordOriginalCurrencyReceipt,
    ) {
      admin(actor);
      const piId = required(input.piId, "PI id");
      const commandId = required(input.commandId, "Command id", 100);
      if (!/^[0-9a-f-]{36}$/i.test(commandId))
        throw new Response("Valid command id required", { status: 400 });
      const currency = required(
        input.currency,
        "Original currency",
        3,
      ).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency) || currency === "USD")
        throw new Response("A non-USD ISO currency is required", {
          status: 400,
        });
      let precision: number;
      try {
        const digits = new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
        }).resolvedOptions().maximumFractionDigits;
        if (typeof digits !== "number")
          throw new Error("Currency precision unavailable");
        precision = digits;
      } catch {
        throw new Response("Unsupported original currency", { status: 400 });
      }
      const amount = required(input.amount, "Original-currency amount", 50);
      const fraction = precision > 0 ? `(?:\\.\\d{1,${precision}})?` : "";
      if (
        !new RegExp(`^(?:0|[1-9]\\d{0,11})${fraction}$`).test(amount) ||
        Number(amount) <= 0
      )
        throw new Response("Invalid original-currency amount or precision", {
          status: 400,
        });
      if (precision > 3)
        throw new Response("Unsupported original-currency precision", {
          status: 400,
        });
      const [whole, decimal = ""] = amount.split(".");
      const amountMinor =
        Number(whole) * 10 ** precision +
        Number(decimal.padEnd(precision, "0"));
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
        throw new Response(
          "Original-currency amount exceeds supported precision",
          { status: 400 },
        );
      const actualChannel = channel(input.actualChannel);
      const reference = required(
        input.verificationReference,
        "External verification reference",
      );
      const hash = await sha(
        JSON.stringify({
          piId,
          actorId: actor.id,
          currency,
          amount,
          actualChannel,
          reference,
        }),
      );
      const saved = await db
        .prepare(
          "SELECT pi_id,command_hash FROM pi_original_currency_receipts WHERE command_id=?",
        )
        .bind(commandId)
        .first<{ pi_id: string; command_hash: string }>();
      if (saved) {
        if (saved.pi_id !== piId || saved.command_hash !== hash)
          throw conflict();
        return { recorded: true as const };
      }
      const before = await account(piId);
      const id = crypto.randomUUID();
      const occurredAt = now();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO pi_original_currency_receipts(id,command_id,command_hash,pi_id,currency,
          amount_decimal,actual_channel,verification_reference,actor_id,recorded_at)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(command_id) DO NOTHING`,
          )
          .bind(
            id,
            commandId,
            hash,
            piId,
            currency,
            amount,
            actualChannel,
            reference,
            actor.id,
            occurredAt,
          ),
        db
          .prepare(
            `INSERT INTO pi_original_currency_receipt_balances(receipt_id,currency_digits,amount_minor)
          SELECT ?,?,? WHERE changes()=1`,
          )
          .bind(id, precision, amountMinor),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'pi.original_currency_receipt','proforma_invoice',?,?,?,?
          WHERE EXISTS(SELECT 1 FROM pi_original_currency_receipt_balances WHERE receipt_id=?)`,
          )
          .bind(
            `payment:${id}`,
            piId,
            actor.id,
            JSON.stringify({
              requestId: before.request_id,
              commandId,
              ipAddress: options.auditIp ?? null,
              currency,
              amount,
              actualChannel,
            }),
            occurredAt,
            id,
          ),
      ]);
      if (results[0].meta.changes !== 1) {
        const concurrent = await db
          .prepare(
            "SELECT pi_id,command_hash FROM pi_original_currency_receipts WHERE command_id=?",
          )
          .bind(commandId)
          .first<{ pi_id: string; command_hash: string }>();
        if (
          !concurrent ||
          concurrent.pi_id !== piId ||
          concurrent.command_hash !== hash
        )
          throw conflict();
      }
      return { recorded: true as const };
    },
    async confirmPayment(actor: AdminIdentity, input: ConfirmPiPayment) {
      admin(actor);
      const piId = required(input.piId, "PI id");
      const commandId = required(input.commandId, "Command id", 100);
      if (!/^[0-9a-f-]{36}$/i.test(commandId))
        throw new Response("Valid command id required", { status: 400 });
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1 ||
        input.externallyVerified !== true
      )
        throw new Response(
          "Explicit current version and external verification required",
          { status: 400 },
        );
      const reference = required(
        input.externalReference,
        "Seller-controlled account verification reference",
      );
      const hash = await sha(
        JSON.stringify({
          piId,
          actorId: actor.id,
          expectedVersion: input.expectedVersion,
          reference,
        }),
      );
      const existing = await db
        .prepare(
          "SELECT command_hash,pi_id FROM pi_payment_confirmations WHERE command_id=?",
        )
        .bind(commandId)
        .first<{ command_hash: string; pi_id: string }>();
      if (existing) {
        if (existing.pi_id !== piId || existing.command_hash !== hash)
          throw conflict();
        return { confirmed: true as const, order: await confirmedOrder(piId) };
      }
      const reverified = await db
        .prepare(
          "SELECT command_hash,pi_id FROM pi_payment_reverifications WHERE command_id=?",
        )
        .bind(commandId)
        .first<{ command_hash: string; pi_id: string }>();
      if (reverified) {
        if (reverified.pi_id !== piId || reverified.command_hash !== hash)
          throw conflict();
        return { confirmed: true as const, order: await confirmedOrder(piId) };
      }
      const before = await account(piId);
      if (
        before.version !== input.expectedVersion ||
        before.current_pi_id !== piId ||
        !before.receipt_history_known ||
        before.term_kind === "legacy_review" ||
        before.late_review_required === 1 ||
        before.amount_received_cents +
          before.allocated_in_cents -
          before.allocated_out_cents -
          before.refunded_cents <
          before.total_due_cents ||
        before.total_due_cents <= 0 ||
        !before.actual_channel
      )
        throw conflict();
      const timestamp = now();
      const id = crypto.randomUUID();
      const orderStatements = await orderCreationStatements(db, {
        piId,
        requestId: before.request_id,
        now: timestamp,
        finalEvent: "payment",
      });
      if (before.confirmation_id && before.confirmation_valid === 0) {
        const held = await db
          .prepare(
            "SELECT 1 FROM pi_payment_disputes WHERE pi_id=? AND active=1",
          )
          .bind(piId)
          .first();
        if (held)
          throw new Response("Owner review must resolve disputed funds first", {
            status: 409,
          });
        const correction = await db
          .prepare(
            `SELECT id FROM pi_payment_corrections WHERE pi_id=?
          ORDER BY corrected_at DESC,id DESC LIMIT 1`,
          )
          .bind(piId)
          .first<{ id: string }>();
        if (!correction) throw conflict();
        const results = await db.batch([
          db
            .prepare(
              `UPDATE pi_payment_accounts SET confirmation_valid=1,version=version+1,updated_at=?
            WHERE pi_id=? AND version=? AND confirmation_valid=0
              AND NOT EXISTS(SELECT 1 FROM pi_payment_disputes WHERE pi_id=? AND active=1)
              AND EXISTS(SELECT 1 FROM proforma_invoice_heads WHERE pi_id=?)
              AND amount_received_cents+allocated_in_cents-allocated_out_cents-refunded_cents>=total_due_cents
              AND ((EXISTS(SELECT 1 FROM pi_acceptances WHERE pi_id=?) AND due_at>=?)
                OR (NOT EXISTS(SELECT 1 FROM pi_acceptances WHERE pi_id=?)
                  AND EXISTS(SELECT 1 FROM proforma_invoices p WHERE p.id=? AND p.valid_until>?)))`,
            )
            .bind(
              timestamp,
              piId,
              input.expectedVersion,
              piId,
              piId,
              piId,
              timestamp,
              piId,
              piId,
              timestamp,
            ),
          db
            .prepare(
              `INSERT INTO pi_payment_reverifications(id,command_id,command_hash,pi_id,
            original_confirmation_id,correction_id,external_reference,actor_id,reverified_at)
            SELECT ?,?,?,?, ?,?,?,?,? WHERE changes()=1`,
            )
            .bind(
              id,
              commandId,
              hash,
              piId,
              before.confirmation_id,
              correction.id,
              reference,
              actor.id,
              timestamp,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
            SELECT ?,'pi.payment_reverified','proforma_invoice',?,?,?,?
            WHERE EXISTS(SELECT 1 FROM pi_payment_reverifications WHERE id=?)`,
            )
            .bind(
              `payment-reverified:${id}`,
              piId,
              actor.id,
              JSON.stringify({
                requestId: before.request_id,
                commandId,
                ipAddress: options.auditIp ?? null,
                correctionId: correction.id,
              }),
              timestamp,
              id,
            ),
          ...orderStatements,
        ]);
        if (results[0].meta.changes !== 1) throw conflict();
        return { confirmed: true as const, order: await confirmedOrder(piId) };
      }
      if (before.confirmation_id) throw conflict();
      const reminderId = `pi-acceptance-reminder:${id}`;
      const reminderBody = `We have confirmed funds for ${before.document_number}. Please review and accept the current PI in My Quotes to complete the order.`;
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO pi_payment_confirmations(id,command_id,command_hash,pi_id,confirmed_cents,currency,
           actual_channel,external_reference,actor_id,confirmed_at)
           SELECT ?,?,?,p.id,a.total_due_cents,'USD',a.actual_channel,?,?,?
           FROM pi_payment_accounts a JOIN proforma_invoices p ON p.id=a.pi_id
           JOIN proforma_invoice_heads h ON h.pi_id=p.id AND h.request_id=p.request_id
           JOIN quote_revisions q ON q.id=p.quote_revision_id AND q.request_id=p.request_id
           WHERE p.id=? AND a.version=? AND a.receipt_history_known=1 AND a.term_kind!='legacy_review'
             AND a.total_due_cents>0 AND a.amount_received_cents+a.allocated_in_cents-a.allocated_out_cents-a.refunded_cents>=a.total_due_cents
             AND a.actual_channel IS NOT NULL
             AND a.confirmation_valid=1
             AND NOT EXISTS(SELECT 1 FROM pi_payment_disputes WHERE pi_id=p.id AND active=1)
             AND p.quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=p.request_id ORDER BY revision_number DESC LIMIT 1)
             AND (NOT EXISTS(SELECT 1 FROM json_each(p.snapshot_json,'$.lines') line
               WHERE json_extract(line.value,'$.madeToOrder')=1)
               OR json_extract(q.snapshot_json,'$.factoryReviewConfirmed')=1)
             AND ((EXISTS(SELECT 1 FROM pi_acceptances WHERE pi_id=p.id)
               AND a.due_at IS NOT NULL AND a.due_at>=?)
               OR (NOT EXISTS(SELECT 1 FROM pi_acceptances WHERE pi_id=p.id)
                 AND p.valid_until>? AND p.issued_at<=?))
           ON CONFLICT(pi_id) DO NOTHING`,
          )
          .bind(
            id,
            commandId,
            hash,
            reference,
            actor.id,
            timestamp,
            piId,
            input.expectedVersion,
            timestamp,
            timestamp,
            timestamp,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
           SELECT ?,'pi.payment_confirmed','proforma_invoice',?,?,?,? WHERE changes()=1`,
          )
          .bind(
            `payment-confirmed:${id}`,
            piId,
            actor.id,
            JSON.stringify({
              requestId: before.request_id,
              commandId,
              ipAddress: options.auditIp ?? null,
              confirmationId: id,
              totalCents: before.total_due_cents,
              actualChannel: before.actual_channel,
            }),
            timestamp,
          ),
        ...orderStatements,
        db
          .prepare(
            `INSERT INTO quote_conversations(request_id,created_at)
           SELECT request_id,? FROM proforma_invoices WHERE id=?
           AND EXISTS(SELECT 1 FROM pi_payment_confirmations WHERE id=?)
           AND NOT EXISTS(SELECT 1 FROM confirmed_orders WHERE pi_id=?)
           ON CONFLICT(request_id) DO NOTHING`,
          )
          .bind(timestamp, piId, id, piId),
        db
          .prepare(
            `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,
           created_at,command_id,payload_hash,source,delivery_state)
           SELECT ?,p.request_id,'admin',?,?,?, ?,?,'website','available'
           FROM proforma_invoices p WHERE p.id=?
           AND EXISTS(SELECT 1 FROM pi_payment_confirmations WHERE id=?)
           AND NOT EXISTS(SELECT 1 FROM confirmed_orders WHERE pi_id=?)
           ON CONFLICT(command_id) DO NOTHING`,
          )
          .bind(
            reminderId,
            actor.id,
            reminderBody,
            timestamp,
            reminderId,
            await sha(reminderBody),
            piId,
            id,
            piId,
          ),
        quoteNotificationOutboxStatement(db, {
          messageId: reminderId,
          requestId: before.request_id,
          createdAt: timestamp,
        }),
      ]);
      if (results[0].meta.changes !== 1) {
        const won = await db
          .prepare(
            "SELECT command_hash,pi_id FROM pi_payment_confirmations WHERE command_id=?",
          )
          .bind(commandId)
          .first<{ command_hash: string; pi_id: string }>();
        if (!won || won.command_hash !== hash || won.pi_id !== piId)
          throw conflict();
      }
      return { confirmed: true as const, order: await confirmedOrder(piId) };
    },
  };
}
