import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { requireAfterSalesPermission } from "../domain/permissions";
import {
  cumulativeLineAmount,
  cumulativeRestockingFee,
  refundComponents,
  usd,
} from "../domain/refund-calculation";
import {
  etDisplayDate,
  inspectionDeadline,
  isOnOrBefore,
} from "../domain/return-policy";
import { customerMessageStatements } from "../infrastructure/d1-customer-messages";
import { createD1OrderFacts } from "../infrastructure/d1-order-facts";
import {
  priorLineCredits,
  projectRefundAuthorization,
  readRefundAuthorizations,
  refundAuthorizationStatements,
} from "../infrastructure/d1-refund-authorizations";
import { afterSalesCommandId, afterSalesText } from "./cancellation-service";
import { createDecisionRevisionService } from "./decision-revision-service";

export const inspectionConditionKeys = [
  "interfaces",
  "sealingSurfaces",
  "finish",
  "packaging",
  "installationEvidence",
  "fluidExposure",
] as const;
export type InspectionConditions = Record<
  (typeof inspectionConditionKeys)[number],
  string
>;

export interface ReturnDecisionLine {
  lineId: string;
  shipmentId: string;
  displayName: string;
  receivedQuantity: number;
  approvedQuantity: number;
  declinedQuantity: number;
  merchandiseCents: number;
}

export interface ReturnDecisionFinancial {
  merchandiseCents: number;
  restockingFeeCents: number;
  logisticsCents: number;
  logisticsNote: string | null;
  sellerLogisticsCents: number;
  sellerLogisticsNote: string | null;
  taxCents: number;
  taxNote: string | null;
  serviceFeeCents: number;
  thirdPartyCostCents: number;
  thirdPartyCostEvidence: string | null;
  grossCents: number;
  refundCents: number;
  outboundDdpRefunded: boolean;
}

const hash = (value: string) => piSha256(new TextEncoder().encode(value));
const conflict = () =>
  new Response("Return state changed; reload", { status: 409 });
const note = (value: unknown, label: string) =>
  typeof value === "string" && value.trim()
    ? afterSalesText(value, label)
    : null;

function instant(value: unknown, label: string, now: string) {
  const text = afterSalesText(value, label, 40);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed))
    throw new Response(`${label} is invalid`, { status: 400 });
  const iso = new Date(parsed).toISOString();
  if (!isOnOrBefore(iso, now))
    throw new Response(`${label} cannot be in the future`, { status: 400 });
  return iso;
}

export function createReturnInspectionService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string | null } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const facts = createD1OrderFacts(db);

  async function caseEventStatements(input: {
    caseId: string;
    orderRequestId: string;
    actorId: string;
    body: string;
    email: string | null;
    commandId: string;
    timestamp: string;
    guard: { sql: string; bindings: unknown[] };
  }) {
    const id = `case-event:${input.commandId}`;
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO after_sales_case_messages
           (id,case_id,author_role,author_id,visibility,kind,body,created_at,
            command_id,command_hash)
           SELECT ?,?,'admin',?,'customer','event',?,?,?,? WHERE ${input.guard.sql}`,
        )
        .bind(
          id,
          input.caseId,
          input.actorId,
          input.body,
          input.timestamp,
          id,
          await hash(input.body),
          ...input.guard.bindings,
        ),
      db
        .prepare(
          `UPDATE after_sales_cases SET version=version+1,updated_at=?
           WHERE id=? AND EXISTS(SELECT 1 FROM after_sales_case_messages WHERE id=?)`,
        )
        .bind(input.timestamp, input.caseId, id),
    ];
    if (input.email)
      statements.push(
        ...(await customerMessageStatements(db, {
          orderRequestId: input.orderRequestId,
          actorId: input.actorId,
          messageId: `case-event-email:${input.commandId}`,
          body: input.email,
          caseId: input.caseId,
          timestamp: input.timestamp,
          guard: {
            sql: "EXISTS(SELECT 1 FROM after_sales_case_messages WHERE id=?)",
            bindings: [id],
          },
        })),
      );
    return statements;
  }

  async function read(orderId: string, audience: "customer" | "admin") {
    const at = now();
    const [receipts, receiptLines, items, decisions, refunds] =
      await Promise.all([
        db
          .prepare(
            `SELECT * FROM after_sales_return_receipts WHERE order_id=?
             ORDER BY received_at,rowid`,
          )
          .bind(orderId)
          .all<{
            id: string;
            ra_id: string;
            case_id: string;
            received_at: string;
            recorded_at: string;
            source: string;
            package_reference: string | null;
            excess_note: string | null;
            timeliness: "timely" | "late";
            late_review_note: string | null;
            late_reviewed_at: string | null;
            inspection_deadline_date_et: string;
            inspection_deadline_at: string;
            actor_id: string;
          }>(),
        db
          .prepare(
            `SELECT l.* FROM after_sales_receipt_lines l
             JOIN after_sales_return_receipts r ON r.id=l.receipt_id WHERE r.order_id=?`,
          )
          .bind(orderId)
          .all<{
            receipt_id: string;
            line_id: string;
            shipment_id: string;
            physical_quantity: number;
          }>(),
        db
          .prepare(
            `SELECT i.* FROM after_sales_inspection_items i
             JOIN after_sales_return_receipts r ON r.id=i.receipt_id WHERE r.order_id=?`,
          )
          .bind(orderId)
          .all<{
            receipt_id: string;
            line_id: string;
            shipment_id: string;
            inspected_quantity: number;
            approved_quantity: number;
            conditions_json: string;
          }>(),
        db
          .prepare(
            `SELECT * FROM after_sales_return_decisions WHERE order_id=?
             ORDER BY decided_at,rowid`,
          )
          .bind(orderId)
          .all<{
            id: string;
            receipt_id: string;
            case_id: string;
            outcome: "approved" | "partially_approved" | "declined";
            responsibility: "customer" | "seller";
            remedy: "refund" | "replacement" | "none";
            customer_reason: string | null;
            internal_note: string | null;
            lines_json: string;
            financial_json: string;
            replacement_json: string | null;
            decided_at: string;
            actor_id: string;
          }>(),
        readRefundAuthorizations(db, { orderId }),
      ]);
    const revisions = await createDecisionRevisionService(db).read(
      orderId,
      decisions.results.map((decision) => decision.id),
    );
    return receipts.results.map((receipt) => {
      const decision = decisions.results.find(
        (item) => item.receipt_id === receipt.id,
      );
      return {
        id: receipt.id,
        raId: receipt.ra_id,
        caseId: receipt.case_id,
        receivedAt: receipt.received_at,
        recordedAt: receipt.recorded_at,
        timeliness: receipt.timeliness,
        lateReviewed: receipt.late_reviewed_at !== null,
        inspectionDeadlineDateEt: receipt.inspection_deadline_date_et,
        inspectionDeadlineAt: receipt.inspection_deadline_at,
        inspectionOverdue:
          !decision && !isOnOrBefore(at, receipt.inspection_deadline_at),
        lines: receiptLines.results
          .filter((line) => line.receipt_id === receipt.id)
          .map((line) => ({
            lineId: line.line_id,
            shipmentId: line.shipment_id,
            physicalQuantity: line.physical_quantity,
          })),
        decision: decision
          ? {
              id: decision.id,
              outcome: decision.outcome,
              responsibility: decision.responsibility,
              remedy: decision.remedy,
              customerReason: decision.customer_reason,
              decidedAt: decision.decided_at,
              lines: JSON.parse(decision.lines_json) as ReturnDecisionLine[],
              financial: JSON.parse(
                decision.financial_json,
              ) as ReturnDecisionFinancial,
              replacement: decision.replacement_json
                ? (JSON.parse(decision.replacement_json) as Record<
                    string,
                    string
                  >)
                : null,
              revisions: revisions.filter(
                (revision) => revision.decisionId === decision.id,
              ),
              refunds: refunds
                .filter(
                  (refund) =>
                    (refund.source_kind === "return" ||
                      refund.source_kind === "supplemental") &&
                    (refund.source_id === decision.id ||
                      revisions.some(
                        (revision) =>
                          revision.decisionId === decision.id &&
                          revision.id === refund.source_id,
                      )),
                )
                .map((refund) => projectRefundAuthorization(refund, audience)),
              ...(audience === "admin"
                ? {
                    internalNote: decision.internal_note,
                    actorId: decision.actor_id,
                  }
                : {}),
            }
          : null,
        ...(audience === "admin"
          ? {
              source: receipt.source,
              packageReference: receipt.package_reference,
              excessNote: receipt.excess_note,
              lateReviewNote: receipt.late_review_note,
              actorId: receipt.actor_id,
              inspection: items.results
                .filter((item) => item.receipt_id === receipt.id)
                .map((item) => ({
                  lineId: item.line_id,
                  shipmentId: item.shipment_id,
                  inspectedQuantity: item.inspected_quantity,
                  approvedQuantity: item.approved_quantity,
                  conditions: JSON.parse(
                    item.conditions_json,
                  ) as InspectionConditions,
                })),
            }
          : {}),
      };
    });
  }

  return {
    async adminRead(actor: AdminIdentity, orderId: string) {
      requireAfterSalesPermission(actor, "after_sales.review");
      return read(orderId, "admin");
    },

    async customerRead(profileId: string, orderId: string) {
      return read(await facts.ownedOrder(profileId, orderId), "customer");
    },

    async adminRecordReceipt(
      actor: AdminIdentity,
      input: {
        orderId: string;
        raId: string;
        receivedAt: string;
        source: string;
        packageReference?: string;
        excessNote?: string;
        lines: Array<{
          lineId: string;
          shipmentId: string;
          physicalQuantity: number;
        }>;
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const commandId = afterSalesCommandId(input.commandId);
      const timestamp = now();
      const receivedAt = instant(
        input.receivedAt,
        "Actual receipt time",
        timestamp,
      );
      const source = afterSalesText(
        input.source,
        "Receipt evidence source",
        500,
      );
      const lines = (input.lines ?? []).filter(
        (line) => line.physicalQuantity > 0,
      );
      if (
        !lines.length ||
        lines.some((line) => !Number.isSafeInteger(line.physicalQuantity))
      )
        throw new Response("Record received quantities", { status: 400 });
      const commandHash = await hash(
        JSON.stringify({ actor: actor.id, input, receivedAt }),
      );
      const replay = await db
        .prepare(
          `SELECT id,command_hash FROM after_sales_return_receipts WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; command_hash: string }>();
      if (replay) {
        if (replay.command_hash !== commandHash) throw conflict();
        return replay.id;
      }
      const ra = await db
        .prepare(
          `SELECT ra.id,ra.ra_number,ra.case_id,ra.issued_at,ra.arrival_deadline_at
           FROM after_sales_return_authorizations ra WHERE ra.id=? AND ra.order_id=?`,
        )
        .bind(input.raId, input.orderId)
        .first<{
          id: string;
          ra_number: string;
          case_id: string;
          issued_at: string;
          arrival_deadline_at: string;
        }>();
      if (!ra) throw new Response("RA not found", { status: 404 });
      if (!isOnOrBefore(ra.issued_at, receivedAt))
        throw new Response("Goods cannot be received before the RA", {
          status: 400,
        });
      const timeliness = isOnOrBefore(receivedAt, ra.arrival_deadline_at)
        ? "timely"
        : "late";
      const deadline = inspectionDeadline(receivedAt);
      const orderFacts = await facts.read(input.orderId);
      const id = crypto.randomUUID();
      const guard = {
        sql: "EXISTS(SELECT 1 FROM after_sales_return_receipts WHERE id=?)",
        bindings: [id],
      };
      const received = lines
        .map(
          (line) =>
            `${orderFacts.lines.find((item) => item.lineId === line.lineId)?.displayName ?? line.lineId} × ${line.physicalQuantity}`,
        )
        .join(", ");
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO after_sales_return_receipts
             (id,ra_id,case_id,order_id,received_at,recorded_at,source,package_reference,
              excess_note,timeliness,inspection_deadline_date_et,inspection_deadline_at,
              calendar_version,actor_id,command_id,command_hash)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            ra.id,
            ra.case_id,
            input.orderId,
            receivedAt,
            timestamp,
            source,
            note(input.packageReference, "Package reference"),
            note(input.excessNote, "Unauthorized or excess goods"),
            timeliness,
            deadline.dateEt,
            deadline.at,
            deadline.calendarVersion,
            actor.id,
            commandId,
            commandHash,
          ),
        ...lines.map((line) =>
          db
            .prepare(
              `INSERT INTO after_sales_receipt_lines
               (receipt_id,ra_id,case_id,line_id,shipment_id,physical_quantity)
               VALUES (?,?,?,?,?,?)`,
            )
            .bind(
              id,
              ra.id,
              ra.case_id,
              line.lineId,
              line.shipmentId,
              line.physicalQuantity,
            ),
        ),
        ...(await caseEventStatements({
          caseId: ra.case_id,
          orderRequestId: orderFacts.requestId,
          actorId: actor.id,
          body:
            timeliness === "timely"
              ? `We received ${received} under ${ra.ra_number}. Inspection comes next; we aim to decide within 5 US business days.`
              : `We received ${received} after ${ra.ra_number} expired. The late arrival is under review before any inspection decision.`,
          email: null,
          commandId,
          timestamp,
          guard,
        })),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES (?,'order.return_received','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `return-receipt:${id}`,
            input.orderId,
            actor.id,
            JSON.stringify({
              receiptId: id,
              raId: ra.id,
              receivedAt,
              recordedAt: timestamp,
              source,
              timeliness,
              lines,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
          ),
      ];
      try {
        await db.batch(statements);
      } catch (error) {
        const concurrent = await db
          .prepare(
            `SELECT id,command_hash FROM after_sales_return_receipts WHERE command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; command_hash: string }>();
        if (concurrent?.command_hash === commandHash) return concurrent.id;
        const message = error instanceof Error ? error.message : "";
        if (/exceeds|requires|match/i.test(message))
          throw new Response(message.replace(/^.*?: /, ""), { status: 409 });
        throw conflict();
      }
      return id;
    },

    async adminReviewLateArrival(
      actor: AdminIdentity,
      input: { orderId: string; receiptId: string; note: string },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const reviewNote = afterSalesText(input.note, "Late arrival review");
      const timestamp = now();
      const result = await db
        .prepare(
          `UPDATE after_sales_return_receipts
           SET late_review_note=?,late_reviewed_by=?,late_reviewed_at=?
           WHERE id=? AND order_id=? AND timeliness='late' AND late_reviewed_at IS NULL`,
        )
        .bind(reviewNote, actor.id, timestamp, input.receiptId, input.orderId)
        .run();
      if (result.meta.changes !== 1) throw conflict();
      await db
        .prepare(
          `INSERT INTO admin_audit_events
           (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
           VALUES (?,'order.late_return_reviewed','confirmed_order',?,?,?,?)`,
        )
        .bind(
          `late-return-review:${input.receiptId}`,
          input.orderId,
          actor.id,
          JSON.stringify({ receiptId: input.receiptId, note: reviewNote }),
          timestamp,
        )
        .run();
    },

    async adminDecide(
      actor: AdminIdentity,
      input: {
        orderId: string;
        receiptId: string;
        responsibility: "customer" | "seller";
        remedy: "refund" | "replacement";
        items: Array<{
          lineId: string;
          shipmentId: string;
          approvedQuantity: number;
          conditions: Partial<InspectionConditions>;
        }>;
        customerReason?: string;
        internalNote?: string;
        logisticsCents?: number;
        logisticsNote?: string;
        sellerLogisticsCents?: number;
        sellerLogisticsNote?: string;
        taxCents?: number;
        taxNote?: string;
        thirdPartyCostCents?: number;
        thirdPartyCostEvidence?: string;
        replacement?: {
          scope: string;
          costs: string;
          fulfillmentEvidence: string;
        };
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const commandId = afterSalesCommandId(input.commandId);
      if (!["customer", "seller"].includes(input.responsibility))
        throw new Response("Choose who is responsible", { status: 400 });
      if (!["refund", "replacement"].includes(input.remedy))
        throw new Response("Choose the remedy", { status: 400 });
      const commandHash = await hash(
        JSON.stringify({ actor: actor.id, input }),
      );
      const replay = await db
        .prepare(
          `SELECT id,command_hash FROM after_sales_return_decisions WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; command_hash: string }>();
      if (replay) {
        if (replay.command_hash !== commandHash) throw conflict();
        return replay.id;
      }
      const receipt = await db
        .prepare(
          `SELECT r.*,c.reason AS case_reason,c.case_number
           FROM after_sales_return_receipts r
           JOIN after_sales_cases c ON c.id=r.case_id
           WHERE r.id=? AND r.order_id=?`,
        )
        .bind(input.receiptId, input.orderId)
        .first<{
          id: string;
          case_id: string;
          case_number: string;
          case_reason: string;
          timeliness: string;
          late_reviewed_at: string | null;
          inspection_deadline_at: string;
        }>();
      if (!receipt) throw new Response("Receipt not found", { status: 404 });
      if (receipt.timeliness === "late" && !receipt.late_reviewed_at)
        throw new Response("Review the late arrival before inspecting it", {
          status: 409,
        });
      if (
        input.responsibility === "customer" &&
        receipt.case_reason !== "convenience_return"
      )
        throw new Response(
          "Customer-choice terms apply only to convenience-return cases",
          { status: 400 },
        );
      if (input.responsibility === "customer" && input.remedy !== "refund")
        throw new Response("A convenience return is resolved by refund", {
          status: 400,
        });
      const receiptLines = (
        await db
          .prepare(
            `SELECT line_id,shipment_id,physical_quantity FROM after_sales_receipt_lines
             WHERE receipt_id=?`,
          )
          .bind(receipt.id)
          .all<{
            line_id: string;
            shipment_id: string;
            physical_quantity: number;
          }>()
      ).results;
      if (
        !Array.isArray(input.items) ||
        input.items.length !== receiptLines.length
      )
        throw new Response("Inspect every received line", { status: 400 });
      const orderFacts = await facts.read(input.orderId);
      const prior = await priorLineCredits(db, input.orderId);
      const creditByLine = new Map<
        string,
        { quantity: number; cents: number }
      >();
      const inspected = receiptLines.map((line) => {
        const item = input.items.find(
          (candidate) =>
            candidate.lineId === line.line_id &&
            candidate.shipmentId === line.shipment_id,
        );
        if (
          !item ||
          !Number.isSafeInteger(item.approvedQuantity) ||
          item.approvedQuantity < 0 ||
          item.approvedQuantity > line.physical_quantity
        )
          throw new Response("Invalid approved quantity", { status: 400 });
        const conditions = Object.fromEntries(
          inspectionConditionKeys.map((key) => [
            key,
            afterSalesText(item.conditions?.[key], `Inspection: ${key}`, 1000),
          ]),
        ) as InspectionConditions;
        const orderLine = orderFacts.lines.find(
          (candidate) => candidate.lineId === line.line_id,
        )!;
        const credited = input.remedy === "refund" ? item.approvedQuantity : 0;
        const already =
          (prior.get(orderLine.lineId)?.quantity ?? 0) +
          (creditByLine.get(orderLine.lineId)?.quantity ?? 0);
        const merchandiseCents = cumulativeLineAmount(
          orderLine.lineTotalCents,
          orderLine.physicalQuantity,
          already,
          credited,
        );
        const current = creditByLine.get(orderLine.lineId) ?? {
          quantity: 0,
          cents: 0,
        };
        creditByLine.set(orderLine.lineId, {
          quantity: current.quantity + credited,
          cents: current.cents + merchandiseCents,
        });
        return {
          line,
          orderLine,
          approved: item.approvedQuantity,
          conditions,
          merchandiseCents,
        };
      });
      const approvedTotal = inspected.reduce(
        (sum, item) => sum + item.approved,
        0,
      );
      const receivedTotal = inspected.reduce(
        (sum, item) => sum + item.line.physical_quantity,
        0,
      );
      const outcome =
        approvedTotal === 0
          ? "declined"
          : approvedTotal === receivedTotal
            ? "approved"
            : "partially_approved";
      const customerReason = note(
        input.customerReason,
        "Customer-visible reason",
      );
      // Every outcome, including full approval, tells the customer why.
      if (!customerReason)
        throw new Response("A decision needs a customer-visible reason", {
          status: 400,
        });
      const merchandiseCents = inspected.reduce(
        (sum, item) => sum + item.merchandiseCents,
        0,
      );
      const customer = input.responsibility === "customer";
      if (customer && (input.logisticsCents ?? 0) > 0)
        throw new Response(
          "Performed outbound DDP shipping and import charges are not refunded for a convenience return",
          { status: 400 },
        );
      if (!customer && (input.thirdPartyCostCents ?? 0) > 0)
        throw new Response("Seller-funded remedies have no deductions", {
          status: 400,
        });
      const priorCustomerMerchandise = (
        await readRefundAuthorizations(db, { orderId: input.orderId })
      )
        .filter(
          (refund) =>
            refund.source_kind === "return" &&
            refund.responsibility === "customer" &&
            refund.status !== "superseded",
        )
        .reduce((sum, refund) => sum + refund.merchandise_cents, 0);
      const cutLines = orderFacts.lines.filter(
        (line) => line.productClass === "cut_hose",
      );
      const approvedCutPieces =
        !customer && input.remedy === "refund"
          ? inspected
              .filter((item) => item.orderLine.productClass === "cut_hose")
              .reduce((sum, item) => sum + item.approved, 0)
          : 0;
      const serviceFeeCents = approvedCutPieces
        ? cumulativeLineAmount(
            orderFacts.charges.cuttingLabeling ?? 0,
            cutLines.reduce((sum, line) => sum + line.physicalQuantity, 0),
            cutLines.reduce(
              (sum, line) => sum + (prior.get(line.lineId)?.quantity ?? 0),
              0,
            ),
            approvedCutPieces,
          )
        : 0;
      const anyApproved = approvedTotal > 0;
      const refund = refundComponents({
        merchandiseCents,
        restockingFeeCents: customer
          ? cumulativeRestockingFee(priorCustomerMerchandise, merchandiseCents)
          : 0,
        logisticsCents: anyApproved ? (input.logisticsCents ?? 0) : 0,
        sellerLogisticsCents: anyApproved
          ? (input.sellerLogisticsCents ?? 0)
          : 0,
        taxCents: anyApproved ? (input.taxCents ?? 0) : 0,
        serviceFeeCents,
        thirdPartyCostCents: anyApproved ? (input.thirdPartyCostCents ?? 0) : 0,
      });
      const logisticsNote = note(input.logisticsNote, "Logistics note");
      const sellerLogisticsNote = note(
        input.sellerLogisticsNote,
        "Seller-funded logistics note",
      );
      const taxNote = note(input.taxNote, "Tax note");
      const thirdPartyCostEvidence = note(
        input.thirdPartyCostEvidence,
        "Third-party cost evidence",
      );
      if (refund.logisticsCents && !logisticsNote)
        throw new Response("Explain the logistics refund", { status: 400 });
      if (refund.sellerLogisticsCents && !sellerLogisticsNote)
        throw new Response("Explain the seller-funded logistics", {
          status: 400,
        });
      if (refund.taxCents && !taxNote)
        throw new Response("Record the accepted tax basis", { status: 400 });
      if (refund.thirdPartyCostCents && !thirdPartyCostEvidence)
        throw new Response("Document the third-party cost", { status: 400 });
      const replacement =
        input.remedy === "replacement" && anyApproved
          ? {
              scope: afterSalesText(
                input.replacement?.scope,
                "Replacement scope",
              ),
              costs: afterSalesText(
                input.replacement?.costs,
                "Seller-funded replacement costs",
              ),
              fulfillmentEvidence: afterSalesText(
                input.replacement?.fulfillmentEvidence,
                "Replacement fulfillment evidence",
              ),
            }
          : null;
      const remedy = !anyApproved ? "none" : input.remedy;
      const decisionLines: ReturnDecisionLine[] = inspected.map((item) => ({
        lineId: item.line.line_id,
        shipmentId: item.line.shipment_id,
        displayName: item.orderLine.displayName,
        receivedQuantity: item.line.physical_quantity,
        approvedQuantity: item.approved,
        declinedQuantity: item.line.physical_quantity - item.approved,
        merchandiseCents: item.merchandiseCents,
      }));
      const financial: ReturnDecisionFinancial = {
        merchandiseCents: refund.merchandiseCents,
        restockingFeeCents: refund.restockingFeeCents,
        logisticsCents: refund.logisticsCents,
        logisticsNote,
        sellerLogisticsCents: refund.sellerLogisticsCents,
        sellerLogisticsNote,
        taxCents: refund.taxCents,
        taxNote,
        serviceFeeCents: refund.serviceFeeCents,
        thirdPartyCostCents: refund.thirdPartyCostCents,
        thirdPartyCostEvidence,
        grossCents: refund.grossCents,
        refundCents: refund.refundCents,
        outboundDdpRefunded: !customer && refund.logisticsCents > 0,
      };
      const id = crypto.randomUUID();
      const authorizationId =
        refund.refundCents > 0 ? crypto.randomUUID() : null;
      const timestamp = now();
      const guard = {
        sql: "EXISTS(SELECT 1 FROM after_sales_return_decisions WHERE id=?)",
        bindings: [id],
      };
      const statements: D1PreparedStatement[] = inspected.map((item) =>
        db
          .prepare(
            `INSERT INTO after_sales_inspection_items
             (receipt_id,line_id,shipment_id,inspected_quantity,approved_quantity,
              conditions_json) VALUES (?,?,?,?,?,?)`,
          )
          .bind(
            receipt.id,
            item.line.line_id,
            item.line.shipment_id,
            item.line.physical_quantity,
            item.approved,
            JSON.stringify(item.conditions),
          ),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO after_sales_return_decisions
             (id,receipt_id,case_id,order_id,outcome,responsibility,remedy,
              customer_reason,internal_note,lines_json,financial_json,replacement_json,
              refund_authorization_id,decided_at,inspection_deadline_at,actor_id,
              command_id,command_hash)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            receipt.id,
            receipt.case_id,
            input.orderId,
            outcome,
            input.responsibility,
            remedy,
            customerReason,
            note(input.internalNote, "Internal note"),
            JSON.stringify(decisionLines),
            JSON.stringify(financial),
            replacement ? JSON.stringify(replacement) : null,
            authorizationId,
            timestamp,
            receipt.inspection_deadline_at,
            actor.id,
            commandId,
            commandHash,
          ),
      );
      let refundLine = "No refund is due from this decision.";
      if (authorizationId) {
        const authorization = refundAuthorizationStatements(db, {
          id: authorizationId,
          orderId: input.orderId,
          sourceKind: "return",
          sourceId: id,
          responsibility: input.responsibility,
          refund,
          thirdPartyCostEvidence,
          lineCredits: [...creditByLine].map(([lineId, value]) => ({
            lineId,
            physicalQuantity: value.quantity,
            merchandiseCents: value.cents,
          })),
          actorId: actor.id,
          timestamp,
          commandId,
          guard,
        });
        statements.push(...authorization.statements);
        refundLine =
          authorization.status === "approved"
            ? `Refund approved: ${usd(refund.refundCents)}. It has not been sent yet; we will initiate it by ${etDisplayDate(authorization.deadline!.dateEt)} ET.`
            : `Proposed refund ${usd(refund.refundCents)} includes a documented third-party cost; please confirm or dispute it in your Order.`;
      }
      const breakdown = [
        `merchandise ${usd(refund.merchandiseCents)}`,
        refund.restockingFeeCents
          ? `restocking fee (10%) -${usd(refund.restockingFeeCents)}`
          : "",
        refund.logisticsCents ? `logistics ${usd(refund.logisticsCents)}` : "",
        refund.sellerLogisticsCents
          ? `return logistics ${usd(refund.sellerLogisticsCents)}`
          : "",
        refund.taxCents ? `Sales Tax ${usd(refund.taxCents)}` : "",
        refund.serviceFeeCents
          ? `Cutting & Labeling Fee ${usd(refund.serviceFeeCents)}`
          : "",
        refund.thirdPartyCostCents
          ? `third-party cost -${usd(refund.thirdPartyCostCents)}`
          : "",
      ]
        .filter(Boolean)
        .join(", ");
      const outcomeText =
        outcome === "approved"
          ? "Approved"
          : outcome === "partially_approved"
            ? "Partially approved"
            : "Declined";
      const body = `Inspection decision: ${outcomeText}. ${decisionLines
        .map(
          (line) =>
            `${line.displayName}: ${line.approvedQuantity} of ${line.receivedQuantity} approved`,
        )
        .join("; ")}.${customerReason ? ` Reason: ${customerReason}` : ""}${
        replacement ? ` Remedy: replacement — ${replacement.scope}.` : ""
      }${authorizationId ? ` Breakdown: ${breakdown}.` : ""}${
        customer
          ? " Performed outbound DDP shipping and import charges are not refunded."
          : ""
      } ${refundLine}`;
      statements.push(
        ...(await caseEventStatements({
          caseId: receipt.case_id,
          orderRequestId: orderFacts.requestId,
          actorId: actor.id,
          body,
          email: `Case ${receipt.case_number} for Order ${orderFacts.orderNumber}: ${body} Reply to this message if you have questions.`,
          commandId,
          timestamp,
          guard,
        })),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'order.return_decided','confirmed_order',?,?,?,? WHERE ${guard.sql}`,
          )
          .bind(
            `return-decision:${id}`,
            input.orderId,
            actor.id,
            JSON.stringify({
              decisionId: id,
              receiptId: receipt.id,
              outcome,
              responsibility: input.responsibility,
              remedy,
              lines: decisionLines,
              financial,
              refundAuthorizationId: authorizationId,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
            ...guard.bindings,
          ),
      );
      try {
        await db.batch(statements);
      } catch (error) {
        const concurrent = await db
          .prepare(
            `SELECT id,command_hash FROM after_sales_return_decisions WHERE command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; command_hash: string }>();
        if (concurrent?.command_hash === commandHash) return concurrent.id;
        const message = error instanceof Error ? error.message : "";
        if (/Gate|exceed|funds|Payment|late arrival|UNIQUE/i.test(message))
          throw new Response(message.replace(/^.*?: /, ""), { status: 409 });
        throw conflict();
      }
      return id;
    },
  };
}

export type ReceiptView = Awaited<
  ReturnType<ReturnType<typeof createReturnInspectionService>["adminRead"]>
>[number];
