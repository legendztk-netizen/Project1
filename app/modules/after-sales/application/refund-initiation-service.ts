import { Temporal } from "@js-temporal/polyfill";

import type { AdminIdentity } from "#workers/admin-access";
import {
  requireAfterSalesPermission,
  requireOwner,
} from "../domain/permissions";
import { usd } from "../domain/refund-calculation";
import {
  etDate,
  etDisplayDate,
  refundInitiationDeadline,
} from "../domain/return-policy";
import { customerMessageStatements } from "../infrastructure/d1-customer-messages";
import { createD1OrderFacts } from "../infrastructure/d1-order-facts";
import {
  projectRefundAuthorization,
  readRefundAuthorizations,
} from "../infrastructure/d1-refund-authorizations";
import { afterSalesCommandId, afterSalesText } from "./after-sales-command";

export type RefundKind = "after_sales" | "shipping";
type Channel = "bank_transfer" | "paypal";

interface DestinationRow {
  id: string;
  order_id: string;
  channel: Channel;
  kind: "original_channel" | "alternative";
  label: string;
  holder_name: string;
  institution: string;
  account_last4: string | null;
  same_purchasing_context: number;
  verification_evidence: string;
  verified_by: string;
  verified_at: string;
}

const conflict = () =>
  new Response("Refund state changed; reload", { status: 409 });
export const channelLabel: Record<Channel, string> = {
  bank_transfer: "Bank transfer",
  paypal: "PayPal",
};

export function createRefundInitiationService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string | null } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const facts = createD1OrderFacts(db);

  async function shippingRefunds(where: string, ...bindings: unknown[]) {
    const rows = (
      await db
        .prepare(
          `SELECT r.id,r.order_id,r.due_cents,r.reserved_at,o.order_number,
             coalesce((SELECT sum(i.amount_cents) FROM order_shipping_change_refund_initiations i
               WHERE i.reservation_id=r.id),0) AS initiated_cents,
             (SELECT json_group_array(json_object('id',i.id,'amountCents',i.amount_cents,
                 'externalReference',i.external_reference,'recordedAt',i.initiated_at,
                 'channel',d.channel,'initiatedDateEt',d.initiated_date_et))
               FROM order_shipping_change_refund_initiations i
               LEFT JOIN order_shipping_change_refund_initiation_details d
                 ON d.initiation_id=i.id
               WHERE i.reservation_id=r.id) AS initiations_json
           FROM order_shipping_change_refund_reservations r
           JOIN confirmed_orders o ON o.id=r.order_id ${where}
           ORDER BY r.reserved_at,r.id`,
        )
        .bind(...bindings)
        .all<{
          id: string;
          order_id: string;
          due_cents: number;
          reserved_at: string;
          order_number: string;
          initiated_cents: number;
          initiations_json: string;
        }>()
    ).results;
    return rows.map((row) => {
      // Historical reservations keep their original commitment date.
      const deadline = refundInitiationDeadline(row.reserved_at);
      return {
        kind: "shipping" as const,
        id: row.id,
        orderId: row.order_id,
        orderNumber: row.order_number,
        refundCents: row.due_cents,
        initiatedCents: row.initiated_cents,
        remainingCents: row.due_cents - row.initiated_cents,
        approvedAt: row.reserved_at,
        deadlineDateEt: deadline.dateEt,
        deadlineAt: deadline.at,
        initiations: JSON.parse(row.initiations_json) as Array<{
          id: string;
          amountCents: number;
          externalReference: string;
          recordedAt: string;
          channel: Channel | null;
          initiatedDateEt: string | null;
        }>,
      };
    });
  }

  async function destinations(orderId: string) {
    return (
      await db
        .prepare(
          `SELECT * FROM after_sales_refund_destinations WHERE order_id=?
           ORDER BY verified_at,rowid`,
        )
        .bind(orderId)
        .all<DestinationRow>()
    ).results;
  }

  async function receiptChannel(orderId: string) {
    return db
      .prepare(
        `SELECT c.actual_channel,c.external_reference FROM confirmed_orders o
         JOIN pi_payment_confirmations c ON c.id=o.confirmation_id WHERE o.id=?`,
      )
      .bind(orderId)
      .first<{ actual_channel: Channel; external_reference: string }>();
  }

  return {
    async adminDue(actor: AdminIdentity, input: { page: number }) {
      requireAfterSalesPermission(actor, "after_sales.refund");
      const afterSales = (
        await db
          .prepare(
            `SELECT a.id,a.order_id,o.order_number,a.source_kind,a.refund_cents,
               a.approved_at,a.deadline_date_et,a.deadline_at,
               coalesce((SELECT sum(i.amount_cents) FROM after_sales_refund_initiations i
                 WHERE i.authorization_id=a.id),0) AS initiated_cents
             FROM after_sales_refund_authorizations a
             JOIN confirmed_orders o ON o.id=a.order_id
             WHERE a.status='approved' ORDER BY a.deadline_at,a.id`,
          )
          .all<{
            id: string;
            order_id: string;
            order_number: string;
            source_kind: string;
            refund_cents: number;
            approved_at: string;
            deadline_date_et: string;
            deadline_at: string;
            initiated_cents: number;
          }>()
      ).results
        .filter((row) => row.refund_cents > row.initiated_cents)
        .map((row) => ({
          kind: "after_sales" as const,
          id: row.id,
          orderId: row.order_id,
          orderNumber: row.order_number,
          source: row.source_kind,
          refundCents: row.refund_cents,
          initiatedCents: row.initiated_cents,
          remainingCents: row.refund_cents - row.initiated_cents,
          approvedAt: row.approved_at,
          deadlineDateEt: row.deadline_date_et,
          deadlineAt: row.deadline_at,
        }));
      const shipping = (await shippingRefunds("WHERE 1=1"))
        .filter((row) => row.remainingCents > 0)
        .map(({ initiations: _initiations, ...row }) => ({
          ...row,
          source: "shipping_change",
        }));
      const all = [...afterSales, ...shipping].sort((a, b) =>
        a.deadlineAt.localeCompare(b.deadlineAt),
      );
      const pageSize = 50;
      const page =
        Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1;
      const at = now();
      return {
        page,
        total: all.length,
        pageCount: Math.max(1, Math.ceil(all.length / pageSize)),
        records: all
          .slice((page - 1) * pageSize, page * pageSize)
          .map((row) => ({ ...row, overdue: row.deadlineAt < at })),
      };
    },

    async adminOrder(actor: AdminIdentity, orderId: string) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const [authorizations, shipping, destinationRows, approvals, channel] =
        await Promise.all([
          readRefundAuthorizations(db, { orderId }),
          shippingRefunds("WHERE r.order_id=?", orderId),
          destinations(orderId),
          db
            .prepare(
              `SELECT ap.* FROM after_sales_destination_approvals ap
               JOIN after_sales_refund_destinations d ON d.id=ap.destination_id
               WHERE d.order_id=?`,
            )
            .bind(orderId)
            .all<{
              destination_id: string;
              refund_kind: RefundKind;
              refund_id: string;
              reason: string;
              approved_by: string;
              approved_at: string;
            }>(),
          receiptChannel(orderId),
        ]);
      return {
        receiptChannel: channel?.actual_channel ?? null,
        originalReference: channel?.external_reference ?? null,
        afterSales: authorizations.map((row) =>
          projectRefundAuthorization(row, "admin"),
        ),
        shipping,
        destinations: destinationRows.map((row) => ({
          id: row.id,
          channel: row.channel,
          kind: row.kind,
          label: row.label,
          holderName: row.holder_name,
          institution: row.institution,
          accountLast4: row.account_last4,
          samePurchasingContext: row.same_purchasing_context === 1,
          verificationEvidence: row.verification_evidence,
          verifiedAt: row.verified_at,
        })),
        approvals: approvals.results.map((row) => ({
          destinationId: row.destination_id,
          refundKind: row.refund_kind,
          refundId: row.refund_id,
          reason: row.reason,
          approvedBy: row.approved_by,
          approvedAt: row.approved_at,
        })),
      };
    },

    async customerShippingRefunds(profileId: string, orderId: string) {
      const owned = await facts.ownedOrder(profileId, orderId);
      return (await shippingRefunds("WHERE r.order_id=?", owned)).map(
        (row) => ({
          id: row.id,
          refundCents: row.refundCents,
          initiatedCents: row.initiatedCents,
          remainingCents: row.remainingCents,
          initiations: row.initiations.map(
            ({ externalReference: _reference, ...initiation }) => initiation,
          ),
        }),
      );
    },

    async adminAddDestination(
      actor: AdminIdentity,
      input: {
        orderId: string;
        channel: Channel;
        kind: "original_channel" | "alternative";
        label: string;
        holderName: string;
        institution: string;
        accountLast4?: string;
        samePurchasingContext: boolean;
        verificationEvidence: string;
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.refund");
      const commandId = afterSalesCommandId(input.commandId);
      if (!["bank_transfer", "paypal"].includes(input.channel))
        throw new Response(
          "Cash, Store Credit and other channels are not refund methods",
          {
            status: 400,
          },
        );
      if (!["original_channel", "alternative"].includes(input.kind))
        throw new Response("Choose the destination type", { status: 400 });
      if (input.kind === "original_channel" && !input.samePurchasingContext)
        throw new Response(
          "An account outside the Purchasing Context is an alternative destination",
          { status: 400 },
        );
      const last4 = (input.accountLast4 ?? "").trim();
      if (last4 && !/^[0-9A-Za-z]{4}$/.test(last4))
        throw new Response("Record only the last four account characters", {
          status: 400,
        });
      const replay = await db
        .prepare(
          `SELECT id FROM after_sales_refund_destinations WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string }>();
      if (replay) return replay.id;
      const order = await db
        .prepare(
          `SELECT purchasing_context_id FROM confirmed_orders WHERE id=?`,
        )
        .bind(input.orderId)
        .first<{ purchasing_context_id: string }>();
      if (!order) throw new Response("Order not found", { status: 404 });
      const id = crypto.randomUUID();
      const timestamp = now();
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO after_sales_refund_destinations
               (id,order_id,purchasing_context_id,channel,kind,label,holder_name,
                institution,account_last4,same_purchasing_context,verification_evidence,
                verified_by,verified_at,command_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              id,
              input.orderId,
              order.purchasing_context_id,
              input.channel,
              input.kind,
              afterSalesText(input.label, "Destination label", 120),
              afterSalesText(input.holderName, "Account holder", 200),
              afterSalesText(input.institution, "Bank or PayPal", 200),
              last4 || null,
              input.samePurchasingContext ? 1 : 0,
              afterSalesText(
                input.verificationEvidence,
                "Verification evidence",
              ),
              actor.id,
              timestamp,
              commandId,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events
               (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
               VALUES (?,'order.refund_destination_verified','confirmed_order',?,?,?,?)`,
            )
            .bind(
              `refund-destination:${id}`,
              input.orderId,
              actor.id,
              // Verification evidence and account details stay out of audit payloads.
              JSON.stringify({
                destinationId: id,
                channel: input.channel,
                kind: input.kind,
              }),
              timestamp,
            ),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/must/i.test(message))
          throw new Response(message.replace(/^.*?: /, ""), { status: 409 });
        throw error;
      }
      return id;
    },

    async ownerApproveDestination(
      actor: AdminIdentity,
      input: {
        orderId: string;
        destinationId: string;
        refundKind: RefundKind;
        refundId: string;
        reason: string;
        commandId: string;
      },
    ) {
      requireOwner(actor);
      const commandId = afterSalesCommandId(input.commandId);
      const reason = afterSalesText(input.reason, "Approval reason");
      const replay = await db
        .prepare(
          `SELECT id FROM after_sales_destination_approvals WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string }>();
      if (replay) return replay.id;
      const destination = await db
        .prepare(
          `SELECT id FROM after_sales_refund_destinations WHERE id=? AND order_id=? AND kind='alternative'`,
        )
        .bind(input.destinationId, input.orderId)
        .first();
      if (!destination)
        throw new Response("Alternative destination not found", {
          status: 404,
        });
      const refund =
        input.refundKind === "after_sales"
          ? await db
              .prepare(
                `SELECT id FROM after_sales_refund_authorizations WHERE id=? AND order_id=?`,
              )
              .bind(input.refundId, input.orderId)
              .first()
          : await db
              .prepare(
                `SELECT id FROM order_shipping_change_refund_reservations WHERE id=? AND order_id=?`,
              )
              .bind(input.refundId, input.orderId)
              .first();
      if (!refund) throw new Response("Refund not found", { status: 404 });
      const id = crypto.randomUUID();
      const timestamp = now();
      await db.batch([
        db
          .prepare(
            `INSERT INTO after_sales_destination_approvals
             (id,destination_id,refund_kind,refund_id,reason,approved_by,
              approver_account_type,approved_at,command_id)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            input.destinationId,
            input.refundKind,
            input.refundId,
            reason,
            actor.id,
            actor.accountType,
            timestamp,
            commandId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES (?,'order.refund_destination_approved','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `refund-destination-approval:${id}`,
            input.orderId,
            actor.id,
            JSON.stringify({
              destinationId: input.destinationId,
              refundKind: input.refundKind,
              refundId: input.refundId,
              reason,
            }),
            timestamp,
          ),
      ]);
      return id;
    },

    async adminRecordInitiation(
      actor: AdminIdentity,
      input: {
        orderId: string;
        refundKind: RefundKind;
        refundId: string;
        destinationId: string;
        amountCents: number;
        initiatedDateEt: string;
        externalReference: string;
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.refund");
      const commandId = afterSalesCommandId(input.commandId);
      if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1)
        throw new Response("Enter the initiated USD amount", { status: 400 });
      const externalReference = afterSalesText(
        input.externalReference,
        "External reference",
        200,
      );
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.initiatedDateEt))
        throw new Response("Enter the ET initiation date", { status: 400 });
      const timestamp = now();
      if (
        Temporal.PlainDate.compare(
          Temporal.PlainDate.from(input.initiatedDateEt),
          Temporal.PlainDate.from(etDate(timestamp)),
        ) > 0
      )
        throw new Response("The initiation date cannot be in the future", {
          status: 400,
        });
      const table =
        input.refundKind === "after_sales"
          ? "after_sales_refund_initiations"
          : "order_shipping_change_refund_initiations";
      const replay = await db
        .prepare(`SELECT id FROM ${table} WHERE command_id=?`)
        .bind(commandId)
        .first<{ id: string }>();
      if (replay) return replay.id;
      const destination = await db
        .prepare(
          `SELECT * FROM after_sales_refund_destinations WHERE id=? AND order_id=?`,
        )
        .bind(input.destinationId, input.orderId)
        .first<DestinationRow>();
      if (!destination)
        throw new Response("Choose a verified destination", { status: 400 });
      const orderFacts = await facts.read(input.orderId);
      let approvedAt: string;
      if (input.refundKind === "after_sales") {
        const [authorization] = await readRefundAuthorizations(db, {
          ids: [input.refundId],
        });
        if (!authorization || authorization.order_id !== input.orderId)
          throw new Response("Refund not found", { status: 404 });
        if (authorization.status !== "approved" || !authorization.approved_at)
          throw new Response("Only an approved refund can be initiated", {
            status: 409,
          });
        approvedAt = authorization.approved_at;
      } else {
        const [reservation] = await shippingRefunds(
          "WHERE r.id=? AND r.order_id=?",
          input.refundId,
          input.orderId,
        );
        if (!reservation)
          throw new Response("Refund not found", { status: 404 });
        approvedAt = reservation.approvedAt;
      }
      if (input.initiatedDateEt < etDate(approvedAt))
        throw new Response("Initiation cannot precede the refund approval", {
          status: 400,
        });
      const id = crypto.randomUUID();
      const guard = {
        sql: `EXISTS(SELECT 1 FROM ${table} WHERE id=?)`,
        bindings: [id],
      };
      const statements: D1PreparedStatement[] =
        input.refundKind === "after_sales"
          ? [
              db
                .prepare(
                  `INSERT INTO after_sales_refund_initiations
                   (id,authorization_id,order_id,amount_cents,channel,initiated_date_et,
                    external_reference,destination_id,actor_id,recorded_at,command_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                )
                .bind(
                  id,
                  input.refundId,
                  input.orderId,
                  input.amountCents,
                  destination.channel,
                  input.initiatedDateEt,
                  externalReference,
                  destination.id,
                  actor.id,
                  timestamp,
                  commandId,
                ),
              db
                .prepare(
                  `INSERT INTO after_sales_refund_events
                   (id,authorization_id,kind,details_json,actor_id,occurred_at,command_id)
                   SELECT ?,?,'initiated',?,?,?,? WHERE ${guard.sql}`,
                )
                .bind(
                  `refund-initiated:${id}`,
                  input.refundId,
                  JSON.stringify({
                    initiationId: id,
                    amountCents: input.amountCents,
                  }),
                  actor.id,
                  timestamp,
                  `refund-initiated:${commandId}`,
                  ...guard.bindings,
                ),
            ]
          : [
              db
                .prepare(
                  `INSERT INTO order_shipping_change_refund_initiations
                   (id,reservation_id,amount_cents,external_reference,actor_id,
                    initiated_at,command_id) VALUES (?,?,?,?,?,?,?)`,
                )
                .bind(
                  id,
                  input.refundId,
                  input.amountCents,
                  externalReference,
                  actor.id,
                  timestamp,
                  commandId,
                ),
              db
                .prepare(
                  `INSERT INTO order_shipping_change_refund_initiation_details
                   (initiation_id,order_id,channel,destination_id,initiated_date_et)
                   VALUES (?,?,?,?,?)`,
                )
                .bind(
                  id,
                  input.orderId,
                  destination.channel,
                  destination.id,
                  input.initiatedDateEt,
                ),
            ];
      statements.push(
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'order.refund_initiated','confirmed_order',?,?,?,? WHERE ${guard.sql}`,
          )
          .bind(
            `refund-initiation:${id}`,
            input.orderId,
            actor.id,
            JSON.stringify({
              initiationId: id,
              refundKind: input.refundKind,
              refundId: input.refundId,
              amountCents: input.amountCents,
              channel: destination.channel,
              destinationId: destination.id,
              initiatedDateEt: input.initiatedDateEt,
              externalReference,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
            ...guard.bindings,
          ),
        ...(await customerMessageStatements(db, {
          orderRequestId: orderFacts.requestId,
          actorId: actor.id,
          messageId: `refund-initiated:${commandId}`,
          body: `Refund initiated for Order ${orderFacts.orderNumber}: ${usd(input.amountCents)} via ${channelLabel[destination.channel]} on ${etDisplayDate(input.initiatedDateEt)} (ET). The website records this step; it doesn't move money, and we can't promise when your bank or PayPal will post the funds.`,
          timestamp,
          guard,
        })),
      );
      try {
        await db.batch(statements);
      } catch (error) {
        const concurrent = await db
          .prepare(`SELECT id FROM ${table} WHERE command_id=?`)
          .bind(commandId)
          .first<{ id: string }>();
        if (concurrent) return concurrent.id;
        const message = error instanceof Error ? error.message : "";
        if (/exceeds|required|funds|approved|entitlement/i.test(message))
          throw new Response(message.replace(/^.*?: /, ""), { status: 409 });
        throw conflict();
      }
      return id;
    },
  };
}

export type OrderRefunds = Awaited<
  ReturnType<ReturnType<typeof createRefundInitiationService>["adminOrder"]>
>;
