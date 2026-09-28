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
  commitment_json?: string | null;
  deadline_date_et: string | null;
  deadline_at: string | null;
  calendar_version: string | null;
  customer_response_at: string | null;
  actor_id: string;
  created_at: string;
  initiated_cents?: number;
  initiations_json?: string;
  on_hold?: number;
}

/** An approval's frozen initiation commitment, carried to a replacement. */
export interface RefundCommitment {
  approvedAt: string;
  deadlineDateEt: string;
  deadlineAt: string;
  calendarVersion: string;
}

/** A carried commitment survives renewed confirmation or a dispute. */
export function authorizationCommitment(
  row: RefundAuthorizationRow,
): RefundCommitment | null {
  if (row.commitment_json)
    return JSON.parse(row.commitment_json) as RefundCommitment;
  return row.approved_at &&
    row.deadline_date_et &&
    row.deadline_at &&
    row.calendar_version
    ? {
        approvedAt: row.approved_at,
        deadlineDateEt: row.deadline_date_et,
        deadlineAt: row.deadline_at,
        calendarVersion: row.calendar_version,
      }
    : null;
}

/** The earliest approved commitment among authorizations being replaced. */
export function earliestCommitment(
  rows: RefundAuthorizationRow[],
): RefundCommitment | null {
  return (
    rows
      .map(authorizationCommitment)
      .filter((value): value is RefundCommitment => value !== null)
      .sort((a, b) => a.deadlineAt.localeCompare(b.deadlineAt))[0] ?? null
  );
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

/**
 * Merchandise already credited under customer terms on this Order (initial
 * return decisions, their revisions and Supplemental Refunds). The 10%
 * restocking fee is cumulative over this base so no decision path rounds
 * differently. `excludeIds` leaves out a chain being recalculated.
 */
export function priorCustomerMerchandise(
  rows: RefundAuthorizationRow[],
  excludeIds: ReadonlySet<string> = new Set(),
) {
  return rows
    .filter(
      (row) =>
        !excludeIds.has(row.id) &&
        row.status !== "superseded" &&
        row.responsibility === "customer" &&
        (row.source_kind === "return" || row.source_kind === "supplemental"),
    )
    .reduce((sum, row) => sum + row.merchandise_cents, 0);
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
    // Keeps the replaced approval's deadline instead of restarting it.
    commitment?: RefundCommitment | null;
    actorId: string;
    timestamp: string;
    commandId: string;
    guard: { sql: string; bindings: unknown[] };
  },
) {
  const status = authorizationStatus(input.responsibility, input.refund);
  const deadline =
    status !== "approved"
      ? null
      : input.commitment
        ? {
            dateEt: input.commitment.deadlineDateEt,
            at: input.commitment.deadlineAt,
            calendarVersion: input.commitment.calendarVersion,
          }
        : refundInitiationDeadline(input.timestamp);
  const approvedAt = !deadline
    ? null
    : (input.commitment?.approvedAt ?? input.timestamp);
  const commitment =
    input.commitment ??
    (deadline && approvedAt
      ? {
          approvedAt,
          deadlineDateEt: deadline.dateEt,
          deadlineAt: deadline.at,
          calendarVersion: deadline.calendarVersion,
        }
      : null);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO after_sales_refund_authorizations
         (id,order_id,source_kind,source_id,responsibility,merchandise_cents,
          logistics_cents,seller_logistics_cents,tax_cents,service_fee_cents,
          restocking_fee_cents,third_party_cost_cents,refund_cents,
          third_party_cost_evidence,status,supersedes_id,previous_authorization_id,
          approved_at,deadline_date_et,deadline_at,calendar_version,actor_id,
          created_at,command_id,commitment_json)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${input.guard.sql}`,
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
        approvedAt,
        deadline?.dateEt ?? null,
        deadline?.at ?? null,
        deadline?.calendarVersion ?? null,
        input.actorId,
        input.timestamp,
        `refund-authorization:${input.commandId}`,
        commitment ? JSON.stringify(commitment) : null,
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
             WHERE i.authorization_id=a.id),0) AS initiated_cents,
           (SELECT json_group_array(json_object('id',i.id,'amountCents',i.amount_cents,
               'channel',i.channel,'initiatedDateEt',i.initiated_date_et,
               'externalReference',i.external_reference,'recordedAt',i.recorded_at))
             FROM (SELECT * FROM after_sales_refund_initiations
               WHERE authorization_id=a.id ORDER BY recorded_at,rowid) i) AS initiations_json,
           EXISTS(SELECT 1 FROM after_sales_refund_holds h
             WHERE h.authorization_id=a.id AND h.released_at IS NULL) AS on_hold
         FROM after_sales_refund_authorizations a WHERE ${clause.sql}
         ORDER BY a.created_at,a.rowid`,
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
    initiations: (
      JSON.parse(row.initiations_json ?? "[]") as Array<{
        id: string;
        amountCents: number;
        channel: "bank_transfer" | "paypal";
        initiatedDateEt: string;
        externalReference: string;
        recordedAt: string;
      }>
    ).map(({ externalReference, ...initiation }) =>
      audience === "admin" ? { ...initiation, externalReference } : initiation,
    ),
    remainingCents:
      row.status === "superseded" ? 0 : row.refund_cents - initiated,
    // A flagged decision revision paused the unpaid remainder.
    onHold: row.on_hold === 1,
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

/**
 * Holds the unpaid remainder of each authorization for a flagged decision
 * revision; the D1 initiation guard refuses a held refund.
 */
export function refundHoldStatements(
  db: D1Database,
  input: {
    authorizationIds: string[];
    revisionId: string;
    timestamp: string;
    guard: { sql: string; bindings: unknown[] };
  },
) {
  return input.authorizationIds.map((id) =>
    db
      .prepare(
        `INSERT INTO after_sales_refund_holds(authorization_id,revision_id,created_at)
         SELECT ?,?,? WHERE ${input.guard.sql}`,
      )
      .bind(id, input.revisionId, input.timestamp, ...input.guard.bindings),
  );
}

/** Releases every active hold on these authorizations for a later revision. */
export function releaseRefundHoldStatements(
  db: D1Database,
  input: {
    authorizationIds: string[];
    revisionId: string;
    timestamp: string;
    guard: { sql: string; bindings: unknown[] };
  },
) {
  if (!input.authorizationIds.length) return [];
  return [
    db
      .prepare(
        `UPDATE after_sales_refund_holds SET released_revision_id=?,released_at=?
         WHERE released_at IS NULL
           AND authorization_id IN (${input.authorizationIds.map(() => "?").join(",")})
           AND ${input.guard.sql}`,
      )
      .bind(
        input.revisionId,
        input.timestamp,
        ...input.authorizationIds,
        ...input.guard.bindings,
      ),
  ];
}
