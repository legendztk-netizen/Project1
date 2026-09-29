import type { AdminIdentity } from "#workers/admin-access";
import { requireAfterSalesPermission } from "../domain/permissions";
import {
  cumulativeLineAmount,
  cumulativeRestockingFee,
  refundComponents,
  usd,
  type CalculatedRefund,
} from "../domain/refund-calculation";
import { etDisplayDate } from "../domain/return-policy";
import { caseEventStatements } from "../infrastructure/d1-case-events";
import { createD1OrderFacts } from "../infrastructure/d1-order-facts";
import {
  earliestCommitment,
  priorCustomerMerchandise as priorCustomerMerchandiseOf,
  readRefundAuthorizations,
  refundAuthorizationStatements,
  refundHoldStatements,
  releaseRefundHoldStatements,
  type RefundAuthorizationRow,
  type RefundCommitment,
} from "../infrastructure/d1-refund-authorizations";
import {
  afterSalesCommandId,
  afterSalesText,
  commandHash as hash,
} from "./after-sales-command";
import type {
  ReturnDecisionFinancial,
  ReturnDecisionLine,
} from "./return-inspection-service";

const conflict = () =>
  new Response("Decision changed; reload", { status: 409 });

const componentKeys = [
  "merchandiseCents",
  "logisticsCents",
  "sellerLogisticsCents",
  "taxCents",
  "serviceFeeCents",
  "restockingFeeCents",
  "thirdPartyCostCents",
] as const;

function rowComponents(row: RefundAuthorizationRow) {
  return {
    merchandiseCents: row.merchandise_cents,
    logisticsCents: row.logistics_cents,
    sellerLogisticsCents: row.seller_logistics_cents,
    taxCents: row.tax_cents,
    serviceFeeCents: row.service_fee_cents,
    restockingFeeCents: row.restocking_fee_cents,
    thirdPartyCostCents: row.third_party_cost_cents,
  };
}

export function createDecisionRevisionService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string | null } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const facts = createD1OrderFacts(db);

  async function chain(orderId: string, decisionId: string) {
    const revisions = (
      await db
        .prepare(
          `SELECT * FROM after_sales_decision_revisions WHERE decision_id=?
           ORDER BY revision_number`,
        )
        .bind(decisionId)
        .all<{
          id: string;
          revision_number: number;
          outcome: string;
          customer_reason: string;
          new_json: string;
          financial_effect: string;
          authorization_id: string | null;
          created_at: string;
        }>()
    ).results;
    const sources = new Set([decisionId, ...revisions.map((item) => item.id)]);
    const authorizations = (
      await readRefundAuthorizations(db, { orderId })
    ).filter(
      (row) =>
        (row.source_kind === "return" || row.source_kind === "supplemental") &&
        sources.has(row.source_id),
    );
    return { revisions, authorizations };
  }

  return {
    async read(orderId: string, decisionIds: string[]) {
      if (!decisionIds.length) return [];
      const rows = (
        await db
          .prepare(
            `SELECT * FROM after_sales_decision_revisions
             WHERE decision_id IN (${decisionIds.map(() => "?").join(",")})
             ORDER BY decision_id,revision_number`,
          )
          .bind(...decisionIds)
          .all<{
            id: string;
            decision_id: string;
            revision_number: number;
            outcome: "approved" | "partially_approved" | "declined";
            customer_reason: string;
            new_json: string;
            financial_effect: "replaced" | "supplemental" | "none" | "flagged";
            authorization_id: string | null;
            created_at: string;
            actor_id: string;
          }>()
      ).results;
      void orderId;
      return rows.map((row) => ({
        id: row.id,
        decisionId: row.decision_id,
        revisionNumber: row.revision_number,
        outcome: row.outcome,
        customerReason: row.customer_reason,
        effective: JSON.parse(row.new_json) as {
          lines: ReturnDecisionLine[];
          financial: ReturnDecisionFinancial;
        },
        financialEffect: row.financial_effect,
        authorizationId: row.authorization_id,
        createdAt: row.created_at,
      }));
    },

    async adminRevise(
      actor: AdminIdentity,
      input: {
        orderId: string;
        decisionId: string;
        expectedRevision: number;
        items: Array<{
          lineId: string;
          shipmentId: string;
          approvedQuantity: number;
        }>;
        customerReason: string;
        logisticsCents?: number;
        logisticsNote?: string;
        sellerLogisticsCents?: number;
        sellerLogisticsNote?: string;
        taxCents?: number;
        taxNote?: string;
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const commandId = afterSalesCommandId(input.commandId);
      const customerReason = afterSalesText(
        input.customerReason,
        "Customer-visible reason",
      );
      const commandHash = await hash(
        JSON.stringify({ actor: actor.id, input }),
      );
      const replay = await db
        .prepare(
          `SELECT id,command_hash FROM after_sales_decision_revisions WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; command_hash: string }>();
      if (replay) {
        if (replay.command_hash !== commandHash) throw conflict();
        return replay.id;
      }
      const decision = await db
        .prepare(
          `SELECT d.*,c.case_number FROM after_sales_return_decisions d
           JOIN after_sales_cases c ON c.id=d.case_id
           WHERE d.id=? AND d.order_id=?`,
        )
        .bind(input.decisionId, input.orderId)
        .first<{
          id: string;
          case_id: string;
          case_number: string;
          outcome: string;
          responsibility: "customer" | "seller";
          remedy: "refund" | "replacement" | "none";
          customer_reason: string | null;
          lines_json: string;
          financial_json: string;
        }>();
      if (!decision) throw new Response("Decision not found", { status: 404 });
      const { revisions, authorizations } = await chain(
        input.orderId,
        decision.id,
      );
      if (revisions.length !== input.expectedRevision) throw conflict();
      const latest = revisions.at(-1);
      const current = latest
        ? (JSON.parse(latest.new_json) as {
            lines: ReturnDecisionLine[];
            financial: ReturnDecisionFinancial;
          })
        : {
            lines: JSON.parse(decision.lines_json) as ReturnDecisionLine[],
            financial: JSON.parse(
              decision.financial_json,
            ) as ReturnDecisionFinancial,
          };
      if (
        !Array.isArray(input.items) ||
        input.items.length !== current.lines.length
      )
        throw new Response("Decide every inspected line", { status: 400 });
      const orderFacts = await facts.read(input.orderId);
      const all = await readRefundAuthorizations(db, {
        orderId: input.orderId,
      });
      const chainIds = new Set(authorizations.map((row) => row.id));
      const effectiveChain = authorizations.filter(
        (row) => row.status !== "superseded",
      );
      const otherCredits = (
        await db
          .prepare(
            `SELECT c.authorization_id,c.line_id,c.physical_quantity,c.merchandise_cents
             FROM after_sales_refund_line_credits c
             JOIN after_sales_refund_authorizations a ON a.id=c.authorization_id
             WHERE c.order_id=? AND a.status!='superseded'`,
          )
          .bind(input.orderId)
          .all<{
            authorization_id: string;
            line_id: string;
            physical_quantity: number;
            merchandise_cents: number;
          }>()
      ).results;
      const creditedQuantity = (lineId: string, inChain: boolean) =>
        otherCredits
          .filter(
            (credit) =>
              credit.line_id === lineId &&
              chainIds.has(credit.authorization_id) === inChain,
          )
          .reduce((sum, credit) => sum + credit.physical_quantity, 0);
      const refunding = decision.remedy !== "replacement";
      const revisedQuantities = new Map<string, number>();
      const newLines: ReturnDecisionLine[] = current.lines.map((line) => {
        const item = input.items.find(
          (candidate) =>
            candidate.lineId === line.lineId &&
            candidate.shipmentId === line.shipmentId,
        );
        if (
          !item ||
          !Number.isSafeInteger(item.approvedQuantity) ||
          item.approvedQuantity < 0 ||
          item.approvedQuantity > line.receivedQuantity
        )
          throw new Response("Invalid approved quantity", { status: 400 });
        const orderLine = orderFacts.lines.find(
          (candidate) => candidate.lineId === line.lineId,
        )!;
        const precedingQuantity = revisedQuantities.get(line.lineId) ?? 0;
        revisedQuantities.set(
          line.lineId,
          precedingQuantity + item.approvedQuantity,
        );
        return {
          ...line,
          approvedQuantity: item.approvedQuantity,
          declinedQuantity: line.receivedQuantity - item.approvedQuantity,
          merchandiseCents: refunding
            ? cumulativeLineAmount(
                orderLine.lineTotalCents,
                orderLine.physicalQuantity,
                creditedQuantity(line.lineId, false) + precedingQuantity,
                item.approvedQuantity,
              )
            : 0,
        };
      });
      const approvedTotal = newLines.reduce(
        (sum, line) => sum + line.approvedQuantity,
        0,
      );
      const receivedTotal = newLines.reduce(
        (sum, line) => sum + line.receivedQuantity,
        0,
      );
      const outcome =
        approvedTotal === 0
          ? "declined"
          : approvedTotal === receivedTotal
            ? "approved"
            : "partially_approved";
      const merchandiseCents = newLines.reduce(
        (sum, line) => sum + line.merchandiseCents,
        0,
      );
      const customer = decision.responsibility === "customer";
      const priorCustomerMerchandise = priorCustomerMerchandiseOf(
        all,
        chainIds,
      );
      const cutLines = orderFacts.lines.filter(
        (line) => line.productClass === "cut_hose",
      );
      const cutApproved =
        !customer && refunding
          ? newLines
              .filter((line) =>
                cutLines.some((cut) => cut.lineId === line.lineId),
              )
              .reduce((sum, line) => sum + line.approvedQuantity, 0)
          : 0;
      const any = approvedTotal > 0;
      const pick = (value: number | undefined, fallback: number) =>
        any ? (value ?? fallback) : 0;
      if (customer && (input.logisticsCents ?? 0) > 0)
        throw new Response(
          "Performed outbound DDP charges are not refunded for a convenience return",
          { status: 400 },
        );
      const target = refundComponents({
        merchandiseCents,
        restockingFeeCents: customer
          ? cumulativeRestockingFee(priorCustomerMerchandise, merchandiseCents)
          : 0,
        logisticsCents: pick(
          input.logisticsCents,
          current.financial.logisticsCents,
        ),
        sellerLogisticsCents: pick(
          input.sellerLogisticsCents,
          current.financial.sellerLogisticsCents,
        ),
        taxCents: pick(input.taxCents, current.financial.taxCents),
        serviceFeeCents: cutApproved
          ? cumulativeLineAmount(
              orderFacts.charges.cuttingLabeling ?? 0,
              cutLines.reduce((sum, line) => sum + line.physicalQuantity, 0),
              cutLines.reduce(
                (sum, line) => sum + creditedQuantity(line.lineId, false),
                0,
              ),
              cutApproved,
            )
          : 0,
        thirdPartyCostCents: any ? current.financial.thirdPartyCostCents : 0,
      });
      const existing = componentKeys.reduce(
        (sum, key) => {
          sum[key] = effectiveChain.reduce(
            (total, row) => total + rowComponents(row)[key],
            0,
          );
          return sum;
        },
        {} as Record<(typeof componentKeys)[number], number>,
      );
      const authorizedCents = effectiveChain.reduce(
        (sum, row) => sum + row.refund_cents,
        0,
      );
      const initiatedCents = effectiveChain.reduce(
        (sum, row) => sum + (row.initiated_cents ?? 0),
        0,
      );
      const id = crypto.randomUUID();
      const timestamp = now();
      const guard = {
        sql: "EXISTS(SELECT 1 FROM after_sales_decision_revisions WHERE id=?)",
        bindings: [id],
      };
      let effect: "replaced" | "supplemental" | "none" | "flagged";
      let authorizationRefund: CalculatedRefund | null = null;
      let lineCredits: Array<{
        lineId: string;
        physicalQuantity: number;
        merchandiseCents: number;
      }> = [];
      const statements: D1PreparedStatement[] = [];
      const newAuthorizationId = crypto.randomUUID();
      const supersede = (rows: RefundAuthorizationRow[]) => {
        for (const row of rows)
          statements.push(
            db
              .prepare(
                `UPDATE after_sales_refund_authorizations
                 SET status='superseded',version=version+1
                 WHERE id=? AND version=? AND status!='superseded' AND ${guard.sql}`,
              )
              .bind(row.id, row.version, ...guard.bindings),
            db
              .prepare(
                `INSERT INTO after_sales_refund_events
                 (id,authorization_id,kind,details_json,actor_id,occurred_at,command_id)
                 SELECT ?,?,'superseded',?,?,?,? WHERE ${guard.sql}`,
              )
              .bind(
                `refund-superseded:${row.id}:${id}`,
                row.id,
                JSON.stringify({ revisionId: id }),
                actor.id,
                timestamp,
                `refund-superseded:${row.id}:${commandId}`,
                ...guard.bindings,
              ),
          );
      };
      const remaining = (row: RefundAuthorizationRow) =>
        row.refund_cents - (row.initiated_cents ?? 0);
      const paid = effectiveChain.filter(
        (row) => (row.initiated_cents ?? 0) > 0 && remaining(row) === 0,
      );
      const partlyPaid = effectiveChain.filter(
        (row) => (row.initiated_cents ?? 0) > 0 && remaining(row) > 0,
      );
      const unpaid = effectiveChain.filter(
        (row) => (row.initiated_cents ?? 0) === 0,
      );
      // Decisions retain Shipment detail, but financial credits are per Order line.
      const lineTotals = new Map<
        string,
        { lineId: string; physicalQuantity: number; merchandiseCents: number }
      >();
      for (const line of newLines) {
        const total = lineTotals.get(line.lineId) ?? {
          lineId: line.lineId,
          physicalQuantity: 0,
          merchandiseCents: 0,
        };
        total.physicalQuantity += refunding ? line.approvedQuantity : 0;
        total.merchandiseCents += refunding ? line.merchandiseCents : 0;
        lineTotals.set(line.lineId, total);
      }
      const unchanged =
        componentKeys.every((key) => target[key] === existing[key]) &&
        [...lineTotals.values()].every(
          (line) =>
            creditedQuantity(line.lineId, true) === line.physicalQuantity,
        );
      const sum = (rows: RefundAuthorizationRow[]) =>
        Object.fromEntries(
          componentKeys.map((key) => [
            key,
            rows.reduce((total, row) => total + rowComponents(row)[key], 0),
          ]),
        ) as Record<(typeof componentKeys)[number], number>;
      const netOf = (value: Record<(typeof componentKeys)[number], number>) =>
        value.merchandiseCents +
        value.logisticsCents +
        value.sellerLogisticsCents +
        value.taxCents +
        value.serviceFeeCents -
        value.restockingFeeCents -
        value.thirdPartyCostCents;
      const creditsBeyond = (rows: RefundAuthorizationRow[]) => {
        const ids = new Set(rows.map((row) => row.id));
        return [...lineTotals.values()]
          .map((line) => {
            const credited = otherCredits.filter(
              (credit) =>
                credit.line_id === line.lineId &&
                ids.has(credit.authorization_id),
            );
            return {
              lineId: line.lineId,
              physicalQuantity: Math.max(
                0,
                line.physicalQuantity -
                  credited.reduce(
                    (sum, credit) => sum + credit.physical_quantity,
                    0,
                  ),
              ),
              merchandiseCents: Math.max(
                0,
                line.merchandiseCents -
                  credited.reduce(
                    (sum, credit) => sum + credit.merchandise_cents,
                    0,
                  ),
              ),
            };
          })
          .filter(
            (credit) =>
              credit.physicalQuantity > 0 || credit.merchandiseCents > 0,
          );
      };
      let commitment: RefundCommitment | null = null;
      let holdIds: string[] = [];
      const increase = target.refundCents - authorizedCents;
      const diff = Object.fromEntries(
        componentKeys.map((key) => [key, target[key] - existing[key]]),
      ) as Record<(typeof componentKeys)[number], number>;
      const beyondPaid = Object.fromEntries(
        componentKeys.map((key) => [key, target[key] - sum(paid)[key]]),
      ) as Record<(typeof componentKeys)[number], number>;
      if (unchanged) effect = "none";
      else if (initiatedCents === 0) {
        // Nothing was sent yet: replace the authorization but keep the
        // original approval's initiation deadline.
        effect =
          target.refundCents > 0 || authorizedCents > 0 ? "replaced" : "none";
        supersede(effectiveChain);
        // A zero-refund revision can leave no effective authorization. The
        // original obligation still lives in the append-only decision chain.
        commitment = earliestCommitment(authorizations);
        if (target.refundCents > 0) {
          authorizationRefund = target;
          lineCredits = creditsBeyond([]);
        }
      } else if (increase > 0 && componentKeys.every((key) => diff[key] >= 0)) {
        effect = "supplemental";
        authorizationRefund = refundComponents(diff);
        lineCredits = creditsBeyond(effectiveChain);
      } else if (
        !partlyPaid.length &&
        componentKeys.every((key) => beyondPaid[key] >= 0) &&
        netOf(beyondPaid) >= 0
      ) {
        // A reduction that stays above what was already sent replaces only
        // the unpaid authorizations.
        effect = "replaced";
        supersede(unpaid);
        commitment = earliestCommitment(unpaid);
        if (netOf(beyondPaid) > 0) {
          authorizationRefund = refundComponents(beyondPaid);
          lineCredits = creditsBeyond(paid);
        }
      } else {
        // Would claw back money or split a partly sent refund: hold every
        // unpaid remainder until a later revision settles it.
        effect = "flagged";
        holdIds = effectiveChain
          .filter((row) => remaining(row) > 0 && row.on_hold !== 1)
          .map((row) => row.id);
      }
      statements.push(
        ...(effect === "flagged"
          ? refundHoldStatements(db, {
              authorizationIds: holdIds,
              revisionId: id,
              timestamp,
              guard,
            })
          : releaseRefundHoldStatements(db, {
              authorizationIds: effectiveChain
                .filter((row) => row.on_hold === 1)
                .map((row) => row.id),
              revisionId: id,
              timestamp,
              guard,
            })),
      );
      const previousAuthorization = [...effectiveChain]
        .reverse()
        .find((row) => (row.initiated_cents ?? 0) > 0);
      statements.unshift(
        db
          .prepare(
            `INSERT INTO after_sales_decision_revisions
             (id,decision_id,revision_number,case_id,order_id,outcome,customer_reason,
              previous_json,new_json,financial_effect,authorization_id,actor_id,
              created_at,command_id,command_hash)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            decision.id,
            input.expectedRevision + 1,
            decision.case_id,
            input.orderId,
            outcome,
            customerReason,
            JSON.stringify(current),
            JSON.stringify({
              lines: newLines,
              financial: {
                ...current.financial,
                merchandiseCents: target.merchandiseCents,
                restockingFeeCents: target.restockingFeeCents,
                logisticsCents: target.logisticsCents,
                logisticsNote:
                  typeof input.logisticsNote === "string" &&
                  input.logisticsNote.trim()
                    ? input.logisticsNote.trim()
                    : current.financial.logisticsNote,
                sellerLogisticsCents: target.sellerLogisticsCents,
                sellerLogisticsNote:
                  typeof input.sellerLogisticsNote === "string" &&
                  input.sellerLogisticsNote.trim()
                    ? input.sellerLogisticsNote.trim()
                    : current.financial.sellerLogisticsNote,
                taxCents: target.taxCents,
                taxNote:
                  typeof input.taxNote === "string" && input.taxNote.trim()
                    ? input.taxNote.trim()
                    : current.financial.taxNote,
                serviceFeeCents: target.serviceFeeCents,
                grossCents: target.grossCents,
                refundCents: target.refundCents,
              },
            }),
            effect,
            authorizationRefund ? newAuthorizationId : null,
            actor.id,
            timestamp,
            commandId,
            commandHash,
          ),
        ...newLines.map((line) =>
          db
            .prepare(
              `INSERT INTO after_sales_decision_revision_lines
               (revision_id,line_id,shipment_id,approved_quantity) VALUES (?,?,?,?)`,
            )
            .bind(id, line.lineId, line.shipmentId, line.approvedQuantity),
        ),
      );
      let refundText = "";
      if (authorizationRefund) {
        const authorization = refundAuthorizationStatements(db, {
          id: newAuthorizationId,
          orderId: input.orderId,
          sourceKind: effect === "supplemental" ? "supplemental" : "return",
          sourceId: id,
          responsibility: decision.responsibility,
          refund: authorizationRefund,
          thirdPartyCostEvidence: current.financial.thirdPartyCostEvidence,
          lineCredits,
          previousAuthorizationId:
            effect === "supplemental"
              ? (previousAuthorization?.id ?? null)
              : null,
          commitment,
          actorId: actor.id,
          timestamp,
          commandId,
          guard,
        });
        statements.push(...authorization.statements);
        refundText =
          effect === "supplemental"
            ? ` Your earlier refund stays as recorded. An additional Supplemental Refund of ${usd(authorizationRefund.refundCents)} is approved and will be initiated by ${etDisplayDate(authorization.deadline!.dateEt)} ET.`
            : ` The revised refund is ${usd(authorizationRefund.refundCents)}${authorization.deadline ? `, to be initiated by ${etDisplayDate(authorization.deadline.dateEt)} ET` : ""}.`;
      } else if (effect === "replaced")
        refundText = " No refund is due under the revised decision.";
      else if (effect === "flagged")
        refundText =
          " Amounts already initiated stay as recorded. Any unpaid part of the refund is paused while we review the corrected amounts with you.";
      const outcomeText =
        outcome === "approved"
          ? "Approved"
          : outcome === "partially_approved"
            ? "Partially approved"
            : "Declined";
      const body = `Revised inspection decision #${input.expectedRevision + 1}: ${outcomeText}. ${newLines
        .map(
          (line) =>
            `${line.displayName}: ${line.approvedQuantity} of ${line.receivedQuantity} approved`,
        )
        .join("; ")}. Reason: ${customerReason}${refundText}`;
      statements.push(
        ...(
          await caseEventStatements(db, {
            caseId: decision.case_id,
            orderRequestId: orderFacts.requestId,
            actorId: actor.id,
            body,
            email: `Case ${decision.case_number}: ${body}`,
            messageId: `decision-revision:${commandId}`,
            commandId,
            timestamp,
            guard,
          })
        ).statements,
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'order.return_decision_revised','confirmed_order',?,?,?,?
             WHERE ${guard.sql}`,
          )
          .bind(
            `decision-revision:${id}`,
            input.orderId,
            actor.id,
            JSON.stringify({
              decisionId: decision.id,
              revisionId: id,
              outcome,
              effect,
              previous: current,
              lines: newLines,
              target,
              authorizedCents,
              initiatedCents,
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
            `SELECT id,command_hash FROM after_sales_decision_revisions WHERE command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; command_hash: string }>();
        if (concurrent?.command_hash === commandHash) return concurrent.id;
        const message = error instanceof Error ? error.message : "";
        if (
          /Gate|exceed|funds|sequence|Supplemental|UNIQUE|superseded/i.test(
            message,
          )
        )
          throw new Response(message.replace(/^.*?: /, ""), { status: 409 });
        throw conflict();
      }
      return id;
    },
  };
}

export type DecisionRevisionView = Awaited<
  ReturnType<ReturnType<typeof createDecisionRevisionService>["read"]>
>[number];
