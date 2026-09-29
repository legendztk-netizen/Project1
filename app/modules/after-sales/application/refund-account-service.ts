import type { AdminIdentity } from "#workers/admin-access";
import {
  hasAfterSalesPermission,
  requireAfterSalesPermission,
} from "../domain/permissions";
import { createD1OrderFacts } from "../infrastructure/d1-order-facts";
import {
  afterSalesCommandId,
  afterSalesText,
  commandHash,
} from "./after-sales-command";

export interface RefundAccountProtector {
  seal(plaintext: string, context: string): Promise<string>;
  open(ciphertext: string, context: string): Promise<string>;
}
export interface BankDetails {
  channel?: "bank_transfer";
  holderName: string;
  bankName: string;
  bankCountry: string;
  accountNumber: string;
  routingCode: string;
  swiftCode: string;
  accountType: string;
  holderAddress: string;
  bankAddress: string;
}
export interface PayPalDetails {
  channel: "paypal";
  holderName: string;
  paypalEmail: string;
}
export type RefundAccountDetails = BankDetails | PayPalDetails;
const context = (orderId: string, id: string) =>
  `refund-bank-account:${orderId}:${id}`;
const changed = () =>
  new Response(
    "Refund account or refund status changed. Refresh and try again.",
    { status: 409 },
  );

// Shared by the read model and the transactional submission guard.
const payableSql = `EXISTS(SELECT 1 FROM after_sales_refund_authorizations a
  WHERE a.order_id=? AND a.status='approved' AND a.refund_cents >
    coalesce((SELECT sum(i.amount_cents) FROM after_sales_refund_initiations i WHERE i.authorization_id=a.id),0)
    AND NOT EXISTS(SELECT 1 FROM after_sales_refund_holds h WHERE h.authorization_id=a.id AND h.released_at IS NULL))
  OR EXISTS(SELECT 1 FROM order_shipping_change_refund_reservations r WHERE r.order_id=? AND r.due_cents >
    coalesce((SELECT sum(i.amount_cents) FROM order_shipping_change_refund_initiations i WHERE i.reservation_id=r.id),0))`;

export function createRefundAccountService(
  db: D1Database,
  options: {
    protector?: RefundAccountProtector;
    now?: () => Date;
    auditIp?: string | null;
  } = {},
) {
  const facts = createD1OrderFacts(db);
  async function latest(orderId: string) {
    return db
      .prepare(
        `SELECT a.*, d.account_last4, d.channel, d.kind FROM after_sales_customer_bank_accounts a
      JOIN after_sales_refund_destinations d ON d.id=a.id WHERE a.order_id=? ORDER BY a.version DESC LIMIT 1`,
      )
      .bind(orderId)
      .first<{
        id: string;
        version: number;
        protected_details: string;
        submitted_at: string;
        account_last4: string | null;
        channel: "bank_transfer" | "paypal";
        kind: "original_channel" | "alternative";
      }>();
  }
  async function status(orderId: string) {
    const channel = await db
      .prepare(
        `SELECT c.actual_channel FROM confirmed_orders o
      JOIN pi_payment_confirmations c ON c.id=o.confirmation_id WHERE o.id=?`,
      )
      .bind(orderId)
      .first<string>("actual_channel");
    const payable = await db
      .prepare(`SELECT CASE WHEN (${payableSql}) THEN 1 ELSE 0 END AS payable`)
      .bind(orderId, orderId)
      .first<number>("payable");
    const account = await latest(orderId);
    return {
      eligible:
        ["bank_transfer", "paypal"].includes(channel ?? "") && payable === 1,
      channel,
      account: account
        ? {
            id: account.id,
            channel: account.channel,
            kind: account.kind,
            version: account.version,
            accountLast4: account.account_last4,
            submittedAt: account.submitted_at,
          }
        : null,
    };
  }
  return {
    async customerRead(profileId: string, orderId: string) {
      const ownedOrderId = await facts.ownedOrder(profileId, orderId);
      const summary = await status(ownedOrderId);
      let details: RefundAccountDetails | null = null;
      if (summary.eligible && summary.account) {
        if (!options.protector)
          throw new Error("Refund account encryption is unavailable");
        const row = await db
          .prepare(
            "SELECT protected_details FROM after_sales_customer_bank_accounts WHERE id=? AND order_id=?",
          )
          .bind(summary.account.id, ownedOrderId)
          .first<{ protected_details: string }>();
        if (!row) throw changed();
        details = JSON.parse(
          await options.protector.open(
            row.protected_details,
            context(ownedOrderId, summary.account.id),
          ),
        ) as RefundAccountDetails;
      }
      return { ...summary, details };
    },
    async adminRead(actor: AdminIdentity, orderId: string) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const summary = await status(orderId);
      let details: RefundAccountDetails | null = null;
      if (
        summary.account &&
        hasAfterSalesPermission(actor, "after_sales.refund")
      ) {
        if (!options.protector)
          throw new Error("Refund account encryption is unavailable");
        const row = (await latest(orderId))!;
        // Bind the summary and details to the same immutable version.
        if (row.id !== summary.account.id) throw changed();
        details = JSON.parse(
          await options.protector.open(
            row.protected_details,
            context(orderId, row.id),
          ),
        ) as RefundAccountDetails;
      }
      return { ...summary, details };
    },
    async customerSubmit(
      profileId: string,
      input: {
        orderId: string;
        expectedVersion: number;
        details: RefundAccountDetails;
        samePurchasingContext: boolean;
        commandId: string;
      },
    ) {
      const orderId = await facts.ownedOrder(profileId, input.orderId);
      const commandId = afterSalesCommandId(input.commandId);
      if (!input.samePurchasingContext)
        throw new Response(
          "Confirm that this account belongs to the person or business that placed this order.",
          { status: 400 },
        );
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 0
      )
        throw changed();
      const detail = input.details;
      let details: RefundAccountDetails;
      if (detail.channel === "paypal") {
        const paypalEmail = afterSalesText(
          detail.paypalEmail,
          "PayPal email",
          254,
        ).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail))
          throw new Response("Enter a valid PayPal email address.", {
            status: 400,
          });
        details = {
          channel: "paypal",
          holderName: afterSalesText(detail.holderName, "Account holder", 200),
          paypalEmail,
        };
      } else {
        if (detail.channel !== undefined && detail.channel !== "bank_transfer")
          throw new Response("Choose bank transfer or PayPal.", {
            status: 400,
          });
        const country = afterSalesText(
          detail.bankCountry,
          "Bank country",
          2,
        ).toUpperCase();
        if (!/^[A-Z]{2}$/.test(country))
          throw new Response("Use a two-letter bank country code.", {
            status: 400,
          });
        const accountNumber = afterSalesText(
          detail.accountNumber,
          "Account number or IBAN",
          40,
        )
          .replace(/[\s-]/g, "")
          .toUpperCase();
        if (!/^[A-Z0-9]{4,34}$/.test(accountNumber))
          throw new Response("Enter a valid account number or IBAN.", {
            status: 400,
          });
        const optional = (v: string, label: string, max = 200) =>
          v?.trim() ? afterSalesText(v, label, max) : "";
        const routingCode = optional(
          detail.routingCode,
          "Routing code",
          20,
        ).replace(/[\s-]/g, "");
        const swiftCode = optional(detail.swiftCode, "SWIFT / BIC", 11)
          .replace(/\s/g, "")
          .toUpperCase();
        if (country === "US" && !/^\d{9}$/.test(routingCode))
          throw new Response(
            "Enter the bank's 9-digit US routing number for incoming transfers.",
            { status: 400 },
          );
        if (
          country !== "US" &&
          !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swiftCode)
        )
          throw new Response("Enter the bank's SWIFT / BIC code.", {
            status: 400,
          });
        if (swiftCode && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swiftCode))
          throw new Response("Check the SWIFT / BIC code.", { status: 400 });
        if (!["checking", "savings", "other"].includes(detail.accountType))
          throw new Response("Choose the account type.", { status: 400 });
        details = {
          holderName: afterSalesText(detail.holderName, "Account holder", 200),
          bankName: afterSalesText(detail.bankName, "Bank name", 200),
          bankCountry: country,
          accountNumber,
          routingCode,
          swiftCode,
          accountType: detail.accountType,
          holderAddress: afterSalesText(
            detail.holderAddress,
            "Account holder address",
            500,
          ),
          bankAddress: optional(detail.bankAddress, "Bank address", 500),
        };
      }
      if (!options.protector)
        throw new Error("Refund account encryption is unavailable");
      // Encrypt the command fingerprint so the database cannot verify guesses of bank details.
      const fingerprintPlaintext = JSON.stringify({
        profileId,
        orderId,
        expectedVersion: input.expectedVersion,
        details,
      });
      const fingerprintDigest = await commandHash(fingerprintPlaintext);
      const replay = await db
        .prepare(
          `SELECT id,command_hash FROM after_sales_customer_bank_accounts WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; command_hash: string }>();
      if (replay) {
        if (
          (await options.protector.open(
            replay.command_hash,
            `refund-account-command:${commandId}`,
          )) !== fingerprintDigest
        )
          throw changed();
        return replay.id;
      }
      const summary = await status(orderId);
      if (
        !summary.eligible ||
        (summary.account?.version ?? 0) !== input.expectedVersion
      )
        throw changed();
      const channel = details.channel ?? "bank_transfer";
      const kind =
        channel === summary.channel ? "original_channel" : "alternative";
      const order = await db
        .prepare(
          "SELECT purchasing_context_id FROM confirmed_orders WHERE id=?",
        )
        .bind(orderId)
        .first<{ purchasing_context_id: string }>();
      const id = crypto.randomUUID();
      const timestamp = (options.now?.() ?? new Date()).toISOString();
      const protectedDetails = await options.protector.seal(
        JSON.stringify(details),
        context(orderId, id),
      );
      const fingerprint = await options.protector.seal(
        fingerprintDigest,
        `refund-account-command:${commandId}`,
      );
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO after_sales_batch_assertions(failed) SELECT 1 WHERE NOT (${payableSql})`,
            )
            .bind(orderId, orderId),
          db
            .prepare(
              `INSERT INTO after_sales_refund_destinations
            (id,order_id,purchasing_context_id,channel,kind,label,holder_name,institution,account_last4,same_purchasing_context,verification_evidence,verified_by,verified_at,command_id)
            VALUES (?,?,?,?,?,?,'Customer-provided (protected)','Account details protected',?,1,'Customer attested account ownership; verify details before remittance',?,?,?)`,
            )
            .bind(
              id,
              orderId,
              order!.purchasing_context_id,
              channel,
              kind,
              channel === "paypal"
                ? "Customer-provided PayPal account"
                : "Customer-provided bank account",
              details.channel === "paypal"
                ? null
                : details.accountNumber.slice(-4),
              `customer:${profileId}`,
              timestamp,
              commandId,
            ),
          db
            .prepare(
              `INSERT INTO after_sales_customer_bank_accounts(id,order_id,profile_id,version,protected_details,submitted_at,command_id,command_hash) VALUES (?,?,?,?,?,?,?,?)`,
            )
            .bind(
              id,
              orderId,
              profileId,
              input.expectedVersion + 1,
              protectedDetails,
              timestamp,
              commandId,
              fingerprint,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
            VALUES (?,'order.refund_account_provided','confirmed_order',?,?,?,?)`,
            )
            .bind(
              `refund-account:${id}`,
              orderId,
              `customer:${profileId}`,
              JSON.stringify({
                accountId: id,
                version: input.expectedVersion + 1,
                commandId,
                ipAddress: options.auditIp ?? null,
              }),
              timestamp,
            ),
        ]);
      } catch {
        const concurrent = await db
          .prepare(
            `SELECT id,command_hash FROM after_sales_customer_bank_accounts WHERE command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; command_hash: string }>();
        if (
          concurrent &&
          (await options.protector.open(
            concurrent.command_hash,
            `refund-account-command:${commandId}`,
          )) === fingerprintDigest
        )
          return concurrent.id;
        throw changed();
      }
      return id;
    },
  };
}
export type CustomerRefundAccount = Awaited<
  ReturnType<ReturnType<typeof createRefundAccountService>["customerRead"]>
>;
export type AdminRefundAccount = Awaited<
  ReturnType<ReturnType<typeof createRefundAccountService>["adminRead"]>
>;
