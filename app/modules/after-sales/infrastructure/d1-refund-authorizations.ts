import type { CalculatedRefund } from "../domain/refund-calculation";
import { refundInitiationDeadline } from "../domain/return-policy";

export type RefundSourceKind = "cancellation" | "return" | "supplemental";
export type RefundAuthorizationStatus =
  "awaiting_customer_confirmation" | "approved" | "disputed" | "superseded";

export interface RefundAuthorizationRow {
  id: string;
  order_id: string;
  source_kind: RefundSourceKind;
  source_id: string;
  responsibility: "customer" | "seller";
  merchandise_cents: number;
  logistics_cents: number;
  seller_logistics_cents: number;
  tax_cents: number;
  service_fee_cents: number;
  restocking_fee_cents: number;
  third_party_cost_cents: number;
  refund_cents: number;
  third_party_cost_evidence: string | null;
  status: RefundAuthorizationStatus;
  version: number;
  supersedes_id: string | null;
  previous_authorization_id: string | null;
  approved_at: string | null;
  deadline_date_et: string | null;
  deadline_at: string | null;
  calendar_version: string | null;
  customer_response_at: string | null;
  actor_id: string;
  created_at: string;
  initiated_cents?: number;
}

/** Physical units and merchandise already credited per line (effective only). */
export async function priorLineCredits(db: D1Database, orderId: string) {
  const rows = (
    await db
      .prepare(
        `SELECT c.line_id,sum(c.physical_quantity) AS quantity,
           sum(c.merchandise_cents) AS merchandise_cents
         FROM after_sales_refund_line_credits c
         JOIN after_sales_refund_authorizations a ON a.id=c.authorization_id
         WHERE c.order_id=? AND a.status!='superseded' GROUP BY c.line_id`,
      )
      .bind(orderId)
      .all<{ line_id: string; quantity: number; merchandise_cents: number }>()
  ).results;
  return new Map(
    rows.map((row) => [
      row.line_id,
      { quantity: row.quantity, merchandiseCents: row.merchandise_cents },
    ]),
  );
}

export function authorizationStatus(
  responsibility: "customer" | "seller",
  refund: CalculatedRefund,
) {
  return responsibility === "customer" && refund.thirdPartyCostCents > 0
    ? ("awaiting_customer_confirmation" as const)
    : ("approved" as const);
}

/**
 * Statements appending one source-linked refund authorization, its per-line
 * merchandise credits and history. The D1 triggers enforce funding, component
 * and cumulative Order ceilings in the same transaction.
 */
export function refundAuthorizationStatements(
  db: D1Database,
  input: {
    id: string;
    orderId: string;
    sourceKind: RefundSourceKind;
    sourceId: string;
    responsibility: "customer" | "seller";
    refund: CalculatedRefund;
    thirdPartyCostEvidence: string | null;
    lineCredits: Array<{
      lineId: string;
      physicalQuantity: number;
      merchandiseCents: number;
    }>;
    previousAuthorizationId?: string | null;
    supersedesId?: string | null;
    actorId: string;
    timestamp: string;
    commandId: string;
    guard: { sql: string; bindings: unknown[] };
  },
) {
  const status = authorizationStatus(input.responsibility, input.refund);
  const deadline =
    status === "approved" ? refundInitiationDeadline(input.timestamp) : null;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO after_sales_refund_authorizations
         (id,order_id,source_kind,source_id,responsibility,merchandise_cents,
          logistics_cents,seller_logistics_cents,tax_cents,service_fee_cents,
          restocking_fee_cents,third_party_cost_cents,refund_cents,
          third_party_cost_evidence,status,supersedes_id,previous_authorization_id,
          approved_at,deadline_date_et,deadline_at,calendar_version,actor_id,
          created_at,command_id)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${input.guard.sql}`,
      )
      .bind(
        input.id,
        input.orderId,
        input.sourceKind,
        input.sourceId,
        input.responsibility,
        input.refund.merchandiseCents,
        input.refund.logisticsCents,
        input.refund.sellerLogisticsCents,
        input.refund.taxCents,
        input.refund.serviceFeeCents,
        input.refund.restockingFeeCents,
        input.refund.thirdPartyCostCents,
        input.refund.refundCents,
        input.thirdPartyCostEvidence,
        status,
        input.supersedesId ?? null,
        input.previousAuthorizationId ?? null,
        deadline ? input.timestamp : null,
        deadline?.dateEt ?? null,
        deadline?.at ?? null,
        deadline?.calendarVersion ?? null,
        input.actorId,
        input.timestamp,
        `refund-authorization:${input.commandId}`,
        ...input.guard.bindings,
      ),
  ];
  for (const credit of input.lineCredits)
    if (credit.physicalQuantity > 0 || credit.merchandiseCents > 0)
      statements.push(
        db
          .prepare(
            `INSERT INTO after_sales_refund_line_credits
             (authorization_id,order_id,line_id,physical_quantity,merchandise_cents)
             SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM after_sales_refund_authorizations
               WHERE id=?)`,
          )
          .bind(
            input.id,
            input.orderId,
            credit.lineId,
            credit.physicalQuantity,
            credit.merchandiseCents,
            input.id,
          ),
      );
  statements.push(
    db
      .prepare(
        `INSERT INTO after_sales_refund_events
         (id,authorization_id,kind,details_json,actor_id,occurred_at,command_id)
         SELECT ?,?,'authorized',?,?,?,? WHERE EXISTS(
           SELECT 1 FROM after_sales_refund_authorizations WHERE id=?)`,
      )
      .bind(
        `refund-authorized:${input.id}`,
        input.id,
        JSON.stringify({ status, refundCents: input.refund.refundCents }),
        input.actorId,
        input.timestamp,
        `refund-authorized:${input.commandId}`,
        input.id,
      ),
  );
  return { statements, status, deadline };
}

export async function readRefundAuthorizations(
  db: D1Database,
  where: { orderId: string } | { ids: string[] },
) {
  const clause =
    "orderId" in where
      ? { sql: "a.order_id=?", bindings: [where.orderId] }
      : {
          sql: `a.id IN (${where.ids.map(() => "?").join(",") || "NULL"})`,
          bindings: where.ids,
        };
  return (
    await db
      .prepare(
        `SELECT a.*,
           coalesce((SELECT sum(i.amount_cents) FROM after_sales_refund_initiations i
             WHERE i.authorization_id=a.id),0) AS initiated_cents
         FROM after_sales_refund_authorizations a WHERE ${clause.sql}
         ORDER BY a.created_at,a.id`,
      )
      .bind(...clause.bindings)
      .all<RefundAuthorizationRow>()
  ).results;
}

export function projectRefundAuthorization(
  row: RefundAuthorizationRow,
  audience: "customer" | "admin",
) {
  const initiated = row.initiated_cents ?? 0;
  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    responsibility: row.responsibility,
    status: row.status,
    version: row.version,
    merchandiseCents: row.merchandise_cents,
    logisticsCents: row.logistics_cents,
    sellerLogisticsCents: row.seller_logistics_cents,
    taxCents: row.tax_cents,
    serviceFeeCents: row.service_fee_cents,
    restockingFeeCents: row.restocking_fee_cents,
    thirdPartyCostCents: row.third_party_cost_cents,
    thirdPartyCostEvidence: row.third_party_cost_evidence,
    grossCents:
      row.merchandise_cents +
      row.logistics_cents +
      row.seller_logistics_cents +
      row.tax_cents +
      row.service_fee_cents,
    refundCents: row.refund_cents,
    initiatedCents: initiated,
    remainingCents:
      row.status === "superseded" ? 0 : row.refund_cents - initiated,
    approvedAt: row.approved_at,
    deadlineDateEt: row.deadline_date_et,
    deadlineAt: row.deadline_at,
    previousAuthorizationId: row.previous_authorization_id,
    createdAt: row.created_at,
    ...(audience === "admin"
      ? { actorId: row.actor_id, calendarVersion: row.calendar_version }
      : {}),
  };
}

export type RefundAuthorizationView = ReturnType<
  typeof projectRefundAuthorization
>;
