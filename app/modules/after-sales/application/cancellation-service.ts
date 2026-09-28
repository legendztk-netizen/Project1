import type { AdminIdentity } from "#workers/admin-access";
import { requireAfterSalesPermission } from "../domain/permissions";
import {
  cumulativeLineAmount,
  customerFinancial,
  refundComponents,
  usd,
} from "../domain/refund-calculation";
import {
  etDisplayDate,
  refundInitiationDeadline,
} from "../domain/return-policy";
import { customerMessageStatements } from "../infrastructure/d1-customer-messages";
import {
  priorLineCredits,
  projectRefundAuthorization,
  readRefundAuthorizations,
  refundAuthorizationStatements,
} from "../infrastructure/d1-refund-authorizations";
import {
  cancellableQuantities,
  createD1OrderFacts,
  type OrderFacts,
} from "../infrastructure/d1-order-facts";
import {
  afterSalesCommandId,
  afterSalesText,
  commandHash as hash,
  optionalAfterSalesText as optionalNote,
} from "./after-sales-command";

export type CancellationStatus = "pending_review" | "withdrawn" | "resolved";

export interface CancellationQuantityInput {
  lineId: string;
  shipmentId: string | null;
  physicalQuantity: number;
}

interface RequestRow {
  id: string;
  order_id: string;
  kind: "standard" | "exceptional";
  origin: "customer" | "support";
  status: CancellationStatus;
  version: number;
  profile_id: string | null;
  actor_id: string;
  reason: string;
  created_at: string;
  updated_at: string;
}

export const cancellationConflict = () =>
  new Response("Cancellation state changed; reload", { status: 409 });

export function parseCancellationQuantities(
  value: unknown,
): CancellationQuantityInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new Response("Select quantities to cancel", { status: 400 });
  const rows = value.map((item) => {
    if (!item || typeof item !== "object")
      throw new Response("Invalid quantity", { status: 400 });
    const row = item as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.physicalQuantity) ||
      (row.physicalQuantity as number) < 1
    )
      throw new Response("Invalid quantity", { status: 400 });
    return {
      lineId: afterSalesText(row.lineId, "Order line", 200),
      shipmentId:
        row.shipmentId === null || row.shipmentId === ""
          ? null
          : afterSalesText(row.shipmentId, "Shipment", 200),
      physicalQuantity: row.physicalQuantity as number,
    };
  });
  const keys = rows.map((row) => `${row.lineId}\u0000${row.shipmentId ?? ""}`);
  if (new Set(keys).size !== keys.length)
    throw new Response("Duplicate order line", { status: 400 });
  return rows;
}

export interface ResolutionLine {
  lineId: string;
  shipmentId: string | null;
  displayName: string;
  requestedQuantity: number;
  approvedQuantity: number;
  declinedQuantity: number;
  merchandiseCents: number;
}

export interface ResolutionFinancial {
  merchandiseCents: number;
  logisticsCents: number;
  logisticsNote: string | null;
  taxCents: number;
  taxNote: string | null;
  serviceFeeCents: number;
  serviceFeeNote: string | null;
  thirdPartyCostCents: number;
  thirdPartyCostEvidence: string | null;
  grossCents: number;
  refundCents: number;
}

export interface FactoryEvidence {
  status: string;
  source: string;
  reviewedAt: string;
  supportReference: string;
  attachmentIds: string[];
  externalIdentifiers: string;
  precut: boolean | null;
}

export interface CancellationDecisionInput {
  orderId: string;
  requestId: string;
  expectedVersion: number;
  commandId: string;
  decisions: Array<{
    lineId: string;
    shipmentId: string | null;
    approvedQuantity: number;
  }>;
  customerReason: string;
  internalNote?: string;
  logisticsCents?: number;
  logisticsNote?: string;
  taxCents?: number;
  taxNote?: string;
  thirdPartyCostCents?: number;
  thirdPartyCostEvidence?: string;
  factoryEvidence?: FactoryEvidence;
}

export function createCancellationService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string | null } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const facts = createD1OrderFacts(db);

  async function requestRows(where: string, ...bindings: unknown[]) {
    return (
      await db
        .prepare(
          `SELECT id,order_id,kind,origin,status,version,profile_id,actor_id,
             reason,created_at,updated_at
           FROM order_cancellation_requests ${where}`,
        )
        .bind(...bindings)
        .all<RequestRow>()
    ).results;
  }

  async function project(
    orderFacts: OrderFacts,
    rows: RequestRow[],
    audience: "customer" | "admin",
  ) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(",");
    const [lines, events, resolutions] = await Promise.all([
      db
        .prepare(
          `SELECT l.request_id,l.line_id,l.shipment_id,l.physical_quantity,l.hold_id,
             h.active AS hold_active
           FROM order_cancellation_request_lines l
           JOIN order_quantity_holds h ON h.id=l.hold_id
           WHERE l.request_id IN (${placeholders})`,
        )
        .bind(...ids)
        .all<{
          request_id: string;
          line_id: string;
          shipment_id: string | null;
          physical_quantity: number;
          hold_id: string;
          hold_active: number;
        }>(),
      db
        .prepare(
          `SELECT request_id,kind,details_json,actor_id,occurred_at
           FROM order_cancellation_events WHERE request_id IN (${placeholders})
           ORDER BY occurred_at,id`,
        )
        .bind(...ids)
        .all<{
          request_id: string;
          kind: string;
          details_json: string;
          actor_id: string;
          occurred_at: string;
        }>(),
      db
        .prepare(
          `SELECT id,request_id,outcome,customer_reason,internal_note,lines_json,
             financial_json,factory_evidence_json,actor_id,decided_at
           FROM order_cancellation_resolutions WHERE request_id IN (${placeholders})`,
        )
        .bind(...ids)
        .all<{
          id: string;
          request_id: string;
          outcome: "approved" | "partially_approved" | "declined";
          customer_reason: string;
          internal_note: string | null;
          lines_json: string;
          financial_json: string;
          factory_evidence_json: string | null;
          actor_id: string;
          decided_at: string;
        }>(),
    ]);
    const refunds = (
      await readRefundAuthorizations(db, { orderId: orderFacts.orderId })
    ).filter((refund) => refund.source_kind === "cancellation");
    const projectFinancial = (financial: ResolutionFinancial) =>
      audience === "customer" ? customerFinancial(financial) : financial;
    return rows.map((row) => {
      const resolution = resolutions.results.find(
        (item) => item.request_id === row.id,
      );
      const requestLines = lines.results
        .filter((line) => line.request_id === row.id)
        .map((line) => {
          const orderLine = orderFacts.lines.find(
            (item) => item.lineId === line.line_id,
          );
          const shipment = orderFacts.shipments.find(
            (item) => item.id === line.shipment_id,
          );
          return {
            lineId: line.line_id,
            lineNumber: orderLine?.lineNumber ?? 0,
            displayName: orderLine?.displayName ?? line.line_id,
            sku: orderLine?.sku ?? "",
            productClass: orderLine?.productClass ?? "standard",
            pieceLengthFt: orderLine?.pieceLengthFt ?? null,
            shipmentId: line.shipment_id,
            shipmentName: shipment?.displayName ?? null,
            physicalQuantity: line.physical_quantity,
            holdActive: line.hold_active === 1,
            handedOff: shipment?.handedOff ?? false,
          };
        })
        .sort((a, b) => a.lineNumber - b.lineNumber);
      return {
        id: row.id,
        orderId: row.order_id,
        kind: row.kind,
        origin: row.origin,
        status: row.status,
        version: row.version,
        reason: row.reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lines: requestLines,
        handoffConflict:
          row.status === "pending_review" &&
          requestLines.some((line) => line.handedOff),
        resolution: resolution
          ? {
              id: resolution.id,
              outcome: resolution.outcome,
              customerReason: resolution.customer_reason,
              decidedAt: resolution.decided_at,
              lines: JSON.parse(resolution.lines_json) as ResolutionLine[],
              financial: projectFinancial(
                JSON.parse(resolution.financial_json) as ResolutionFinancial,
              ),
              refunds: refunds
                .filter((refund) => refund.source_id === resolution.id)
                .map((refund) => projectRefundAuthorization(refund, audience)),
              ...(audience === "admin"
                ? {
                    actorId: resolution.actor_id,
                    internalNote: resolution.internal_note,
                    factoryEvidence: resolution.factory_evidence_json
                      ? (JSON.parse(
                          resolution.factory_evidence_json,
                        ) as FactoryEvidence)
                      : null,
                  }
                : {}),
            }
          : null,
        events: events.results
          .filter((event) => event.request_id === row.id)
          .map((event) => ({
            kind: event.kind,
            occurredAt: event.occurred_at,
            ...(audience === "admin"
              ? {
                  actorId: event.actor_id,
                  details: JSON.parse(event.details_json) as Record<
                    string,
                    unknown
                  >,
                }
              : {}),
          })),
      };
    });
  }

  async function validatedFactoryEvidence(
    value: FactoryEvidence | undefined,
    requestId: string,
    orderId: string,
  ): Promise<FactoryEvidence> {
    if (!value || typeof value !== "object")
      throw new Response("Record the actual factory information", {
        status: 400,
      });
    const reviewedAt = afterSalesText(
      value.reviewedAt,
      "Factory review time",
      40,
    );
    const reviewed = Date.parse(reviewedAt);
    if (!Number.isFinite(reviewed) || reviewed > Date.parse(now()))
      throw new Response("Factory review time must be an actual past time", {
        status: 400,
      });
    const attachmentIds = Array.isArray(value.attachmentIds)
      ? [...new Set(value.attachmentIds.map(String))].slice(0, 20)
      : [];
    if (attachmentIds.length) {
      const found = await db
        .prepare(
          `SELECT count(*) AS count FROM after_sales_files
           WHERE order_id=? AND scope_kind='cancellation' AND scope_id=?
             AND id IN (${attachmentIds.map(() => "?").join(",")})`,
        )
        .bind(orderId, requestId, ...attachmentIds)
        .first<number>("count");
      if (found !== attachmentIds.length)
        throw new Response("Supporting files must belong to this review", {
          status: 400,
        });
    }
    return {
      status: afterSalesText(value.status, "Actual factory status", 1000),
      source: afterSalesText(value.source, "Factory information source", 300),
      reviewedAt: new Date(reviewed).toISOString(),
      supportReference: afterSalesText(
        value.supportReference,
        "Support contact reference",
        300,
      ),
      attachmentIds,
      externalIdentifiers:
        typeof value.externalIdentifiers === "string"
          ? value.externalIdentifiers.trim().slice(0, 500)
          : "",
      precut:
        value.precut === true ? true : value.precut === false ? false : null,
    };
  }

  async function assertAdminOrder(actor: AdminIdentity, orderId: string) {
    requireAfterSalesPermission(actor, "after_sales.review");
    return facts.read(orderId);
  }

  async function closeByCustomer(
    profileId: string,
    input: {
      orderId: string;
      requestId: string;
      expectedVersion: number;
      commandId: string;
    },
  ) {
    const commandId = afterSalesCommandId(input.commandId);
    const orderId = await facts.ownedOrder(profileId, input.orderId);
    const eventId = `cancellation-withdrawn:${commandId}`;
    const replay = await db
      .prepare(
        `SELECT request_id,actor_id FROM order_cancellation_events WHERE id=?`,
      )
      .bind(eventId)
      .first<{ request_id: string; actor_id: string }>();
    if (replay) {
      if (
        replay.request_id !== input.requestId ||
        replay.actor_id !== profileId
      )
        throw cancellationConflict();
      return;
    }
    const [request] = await requestRows(
      "WHERE id=? AND order_id=?",
      input.requestId,
      orderId,
    );
    if (!request || request.origin !== "customer")
      throw new Response("Cancellation request not found", { status: 404 });
    if (
      request.status !== "pending_review" ||
      request.version !== input.expectedVersion
    )
      throw cancellationConflict();
    const timestamp = now();
    try {
      const results = await db.batch([
        db
          .prepare(
            `UPDATE order_cancellation_requests
             SET status='withdrawn',version=version+1,updated_at=?
             WHERE id=? AND order_id=? AND version=? AND status='pending_review'`,
          )
          .bind(timestamp, request.id, orderId, input.expectedVersion),
        db
          .prepare(
            `INSERT INTO order_cancellation_events
             (id,request_id,kind,details_json,actor_id,occurred_at,command_id)
             SELECT ?,?,'withdrawn','{}',?,?,? WHERE changes()=1`,
          )
          .bind(eventId, request.id, profileId, timestamp, commandId),
        db
          .prepare(
            `UPDATE order_quantity_holds SET active=0,resolved_at=?
             WHERE active=1 AND id IN (SELECT hold_id
               FROM order_cancellation_request_lines WHERE request_id=?)
               AND EXISTS(SELECT 1 FROM order_cancellation_events WHERE id=?)`,
          )
          .bind(timestamp, request.id, eventId),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'order.cancellation_withdrawn','confirmed_order',?,?,?,?
             WHERE EXISTS(SELECT 1 FROM order_cancellation_events WHERE id=?)`,
          )
          .bind(
            eventId,
            orderId,
            profileId,
            JSON.stringify({
              requestId: request.id,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
            eventId,
          ),
      ]);
      if (results[0].meta.changes !== 1) throw cancellationConflict();
    } catch (error) {
      if (error instanceof Response) throw error;
      throw cancellationConflict();
    }
  }

  return {
    async customerRead(profileId: string, orderId: string) {
      const owned = await facts.ownedOrder(profileId, orderId);
      const orderFacts = await facts.read(owned);
      const rows = await requestRows(
        "WHERE order_id=? ORDER BY created_at DESC,id DESC",
        owned,
      );
      return {
        eligible: cancellableQuantities(orderFacts).map((item) => {
          const line = orderFacts.lines.find(
            (candidate) => candidate.lineId === item.lineId,
          )!;
          return {
            ...item,
            displayName: line.displayName,
            sku: line.sku,
            shipmentName:
              orderFacts.shipments.find(
                (shipment) => shipment.id === item.shipmentId,
              )?.displayName ?? null,
          };
        }),
        requests: await project(orderFacts, rows, "customer"),
        supportOnlyLines: orderFacts.lines
          .filter((line) => line.productClass !== "standard")
          .filter((line) =>
            cancellableQuantities(orderFacts, [
              "made_to_order",
              "cut_hose",
            ]).some((item) => item.lineId === line.lineId),
          )
          .map((line) => ({
            lineId: line.lineId,
            displayName: line.displayName,
            productClass: line.productClass,
          })),
        conversationPath: `/account/messages/${encodeURIComponent(orderFacts.requestId)}`,
      };
    },

    async adminExceptionalEligible(actor: AdminIdentity, orderId: string) {
      const orderFacts = await assertAdminOrder(actor, orderId);
      return cancellableQuantities(orderFacts, [
        "made_to_order",
        "cut_hose",
      ]).map((item) => {
        const line = orderFacts.lines.find(
          (candidate) => candidate.lineId === item.lineId,
        )!;
        return {
          ...item,
          displayName: line.displayName,
          sku: line.sku,
          productClass: line.productClass,
          pieceLengthFt: line.pieceLengthFt,
          shipmentName:
            orderFacts.shipments.find(
              (shipment) => shipment.id === item.shipmentId,
            )?.displayName ?? null,
        };
      });
    },

    async adminRead(actor: AdminIdentity, orderId: string) {
      const orderFacts = await assertAdminOrder(actor, orderId);
      const rows = await requestRows(
        "WHERE order_id=? ORDER BY created_at DESC,id DESC",
        orderId,
      );
      return project(orderFacts, rows, "admin");
    },

    async adminList(
      actor: AdminIdentity,
      input: { status: CancellationStatus | "all"; page: number },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const pageSize = 50;
      const page =
        Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1;
      const statusWhere =
        input.status === "all" ? "" : "WHERE request.status=?1";
      const bindings = input.status === "all" ? [] : [input.status];
      const [rows, total] = await Promise.all([
        db
          .prepare(
            `SELECT request.id,request.order_id,request.kind,request.origin,
               request.status,request.created_at,request.updated_at,
               o.order_number,
               (SELECT sum(physical_quantity) FROM order_cancellation_request_lines l
                 WHERE l.request_id=request.id) AS physical_quantity,
               EXISTS(SELECT 1 FROM order_cancellation_request_lines l
                 JOIN shipment_dispatch_quantities d ON d.shipment_id=l.shipment_id
                 WHERE l.request_id=request.id) AS handoff_conflict
             FROM order_cancellation_requests request
             JOIN confirmed_orders o ON o.id=request.order_id
             ${statusWhere}
             ORDER BY request.created_at DESC,request.id DESC
             LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
          )
          .bind(...bindings)
          .all<{
            id: string;
            order_id: string;
            kind: string;
            origin: string;
            status: CancellationStatus;
            created_at: string;
            updated_at: string;
            order_number: string;
            physical_quantity: number;
            handoff_conflict: number;
          }>(),
        db
          .prepare(
            `SELECT count(*) AS count FROM order_cancellation_requests request ${statusWhere}`,
          )
          .bind(...bindings)
          .first<{ count: number }>(),
      ]);
      return {
        page,
        pageCount: Math.max(1, Math.ceil((total?.count ?? 0) / pageSize)),
        total: total?.count ?? 0,
        records: rows.results.map((row) => ({
          id: row.id,
          orderId: row.order_id,
          orderNumber: row.order_number,
          kind: row.kind,
          origin: row.origin,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          physicalQuantity: row.physical_quantity,
          handoffConflict:
            row.status === "pending_review" && !!row.handoff_conflict,
        })),
      };
    },

    async customerSubmit(
      profileId: string,
      input: {
        orderId: string;
        reason: string;
        quantities: unknown;
        commandId: string;
      },
    ) {
      const commandId = afterSalesCommandId(input.commandId);
      const reason = afterSalesText(input.reason, "Cancellation reason");
      const quantities = parseCancellationQuantities(input.quantities);
      const orderId = await facts.ownedOrder(profileId, input.orderId);
      const commandHash = await hash(
        JSON.stringify({ profileId, orderId, reason, quantities }),
      );
      const replay = async () =>
        db
          .prepare(
            `SELECT id,submission_hash FROM order_cancellation_requests
             WHERE submission_command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; submission_hash: string }>();
      const prior = await replay();
      if (prior) {
        if (prior.submission_hash !== commandHash) throw cancellationConflict();
        return prior.id;
      }
      const orderFacts = await facts.read(orderId);
      const eligible = cancellableQuantities(orderFacts);
      for (const quantity of quantities) {
        const line = orderFacts.lines.find(
          (item) => item.lineId === quantity.lineId,
        );
        if (!line) throw new Response("Unknown order line", { status: 400 });
        if (line.productClass !== "standard")
          throw new Response(
            "Made-to-order and cut products require Support review",
            { status: 400 },
          );
        const available = eligible.find(
          (item) =>
            item.lineId === quantity.lineId &&
            item.shipmentId === quantity.shipmentId,
        );
        if (!available || quantity.physicalQuantity > available.available)
          throw cancellationConflict();
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO order_cancellation_requests
             (id,order_id,kind,origin,status,profile_id,actor_id,reason,
              submission_command_id,submission_hash,created_at,updated_at)
             VALUES (?,?,'standard','customer','pending_review',?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            orderId,
            profileId,
            profileId,
            reason,
            commandId,
            commandHash,
            timestamp,
            timestamp,
          ),
      ];
      for (const quantity of quantities) {
        const holdId = crypto.randomUUID();
        statements.push(
          db
            .prepare(
              `INSERT INTO order_quantity_holds
               (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
               VALUES (?,?,?,?,?,'cancellation',?,?)`,
            )
            .bind(
              holdId,
              orderId,
              quantity.lineId,
              quantity.shipmentId,
              quantity.physicalQuantity,
              `Cancellation request ${id}`,
              timestamp,
            ),
          db
            .prepare(
              `INSERT INTO order_cancellation_request_lines
               (request_id,order_id,line_id,shipment_id,physical_quantity,hold_id)
               VALUES (?,?,?,?,?,?)`,
            )
            .bind(
              id,
              orderId,
              quantity.lineId,
              quantity.shipmentId,
              quantity.physicalQuantity,
              holdId,
            ),
        );
      }
      statements.push(
        db
          .prepare(
            `INSERT INTO order_cancellation_events
             (id,request_id,kind,details_json,actor_id,occurred_at,command_id)
             VALUES (?,?,'submitted',?,?,?,?)`,
          )
          .bind(
            `cancellation-submitted:${commandId}`,
            id,
            JSON.stringify({ quantities }),
            profileId,
            timestamp,
            commandId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES (?,'order.cancellation_requested','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `cancellation-request:${id}`,
            orderId,
            profileId,
            JSON.stringify({
              requestId: id,
              commandId,
              quantities,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
          ),
      );
      try {
        await db.batch(statements);
      } catch {
        const concurrent = await replay();
        if (concurrent?.submission_hash === commandHash) return concurrent.id;
        throw cancellationConflict();
      }
      return id;
    },

    customerWithdraw: closeByCustomer,

    async adminOpenExceptional(
      actor: AdminIdentity,
      input: {
        orderId: string;
        reason: string;
        supportReference: string;
        quantities: unknown;
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const commandId = afterSalesCommandId(input.commandId);
      const reason = afterSalesText(input.reason, "Support request summary");
      const supportReference = afterSalesText(
        input.supportReference,
        "Support contact reference",
        300,
      );
      const quantities = parseCancellationQuantities(input.quantities);
      const commandHash = await hash(
        JSON.stringify({
          actor: actor.id,
          orderId: input.orderId,
          reason,
          supportReference,
          quantities,
        }),
      );
      const replay = await db
        .prepare(
          `SELECT id,submission_hash FROM order_cancellation_requests
           WHERE submission_command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; submission_hash: string }>();
      if (replay) {
        if (replay.submission_hash !== commandHash)
          throw cancellationConflict();
        return replay.id;
      }
      const orderFacts = await facts.read(input.orderId);
      const eligible = cancellableQuantities(orderFacts, [
        "made_to_order",
        "cut_hose",
      ]);
      for (const quantity of quantities) {
        const line = orderFacts.lines.find(
          (item) => item.lineId === quantity.lineId,
        );
        if (!line || line.productClass === "standard")
          throw new Response(
            "Standard products use the customer cancellation request",
            { status: 400 },
          );
        const available = eligible.find(
          (item) =>
            item.lineId === quantity.lineId &&
            item.shipmentId === quantity.shipmentId,
        );
        if (!available || quantity.physicalQuantity > available.available)
          throw cancellationConflict();
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO order_cancellation_requests
             (id,order_id,kind,origin,status,profile_id,actor_id,reason,
              submission_command_id,submission_hash,created_at,updated_at)
             VALUES (?,?,'exceptional','support','pending_review',NULL,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            orderFacts.orderId,
            actor.id,
            reason,
            commandId,
            commandHash,
            timestamp,
            timestamp,
          ),
      ];
      for (const quantity of quantities) {
        const holdId = crypto.randomUUID();
        statements.push(
          db
            .prepare(
              `INSERT INTO order_quantity_holds
               (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
               VALUES (?,?,?,?,?,'cancellation',?,?)`,
            )
            .bind(
              holdId,
              orderFacts.orderId,
              quantity.lineId,
              quantity.shipmentId,
              quantity.physicalQuantity,
              `Exceptional cancellation review ${id}`,
              timestamp,
            ),
          db
            .prepare(
              `INSERT INTO order_cancellation_request_lines
               (request_id,order_id,line_id,shipment_id,physical_quantity,hold_id)
               VALUES (?,?,?,?,?,?)`,
            )
            .bind(
              id,
              orderFacts.orderId,
              quantity.lineId,
              quantity.shipmentId,
              quantity.physicalQuantity,
              holdId,
            ),
        );
      }
      statements.push(
        db
          .prepare(
            `INSERT INTO order_cancellation_events
             (id,request_id,kind,details_json,actor_id,occurred_at,command_id)
             VALUES (?,?,'submitted',?,?,?,?)`,
          )
          .bind(
            `cancellation-submitted:${commandId}`,
            id,
            JSON.stringify({ quantities, supportReference }),
            actor.id,
            timestamp,
            commandId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES (?,'order.exceptional_cancellation_opened','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `exceptional-cancellation:${id}`,
            orderFacts.orderId,
            actor.id,
            JSON.stringify({
              requestId: id,
              supportReference,
              quantities,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
          ),
      );
      try {
        await db.batch(statements);
      } catch {
        const concurrent = await db
          .prepare(
            `SELECT id,submission_hash FROM order_cancellation_requests
             WHERE submission_command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; submission_hash: string }>();
        if (concurrent?.submission_hash === commandHash) return concurrent.id;
        throw cancellationConflict();
      }
      return id;
    },

    async adminResolve(actor: AdminIdentity, input: CancellationDecisionInput) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const commandId = afterSalesCommandId(input.commandId);
      const customerReason = afterSalesText(
        input.customerReason,
        "Customer-visible reason",
      );
      const internalNote = optionalNote(input.internalNote, "Internal note");
      const logisticsNote = optionalNote(input.logisticsNote, "Logistics note");
      const taxNote = optionalNote(input.taxNote, "Tax note");
      const thirdPartyCostEvidence = optionalNote(
        input.thirdPartyCostEvidence,
        "Third-party cost evidence",
      );
      if (!Array.isArray(input.decisions) || !input.decisions.length)
        throw new Response("Decide each requested quantity", { status: 400 });
      const commandHash = await hash(
        JSON.stringify({ actor: actor.id, input }),
      );
      const replay = await db
        .prepare(
          `SELECT id,command_hash FROM order_cancellation_resolutions WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; command_hash: string }>();
      if (replay) {
        if (replay.command_hash !== commandHash) throw cancellationConflict();
        return replay.id;
      }
      const [request] = await requestRows(
        "WHERE id=? AND order_id=?",
        input.requestId,
        input.orderId,
      );
      if (!request)
        throw new Response("Cancellation request not found", { status: 404 });
      if (
        request.status !== "pending_review" ||
        request.version !== input.expectedVersion
      )
        throw cancellationConflict();
      const orderFacts = await facts.read(request.order_id);
      const [view] = await project(orderFacts, [request], "admin");
      const factoryEvidence =
        request.kind === "exceptional"
          ? await validatedFactoryEvidence(
              input.factoryEvidence,
              request.id,
              request.order_id,
            )
          : null;
      if (request.kind === "standard" && input.factoryEvidence)
        throw new Response("Factory review applies only to Support cases", {
          status: 400,
        });
      if (view.lines.length !== input.decisions.length)
        throw new Response("Decide each requested quantity", { status: 400 });
      const prior = await priorLineCredits(db, request.order_id);
      const decided = view.lines.map((line) => {
        const decision = input.decisions.find(
          (item) =>
            item.lineId === line.lineId &&
            (item.shipmentId ?? null) === line.shipmentId,
        );
        if (
          !decision ||
          !Number.isSafeInteger(decision.approvedQuantity) ||
          decision.approvedQuantity < 0 ||
          decision.approvedQuantity > line.physicalQuantity
        )
          throw new Response("Invalid approved quantity", { status: 400 });
        if (decision.approvedQuantity > 0 && line.handedOff)
          throw new Response("Handed-off quantities can only be declined", {
            status: 409,
          });
        return { line, approved: decision.approvedQuantity };
      });
      const approvedLines = decided.filter((item) => item.approved > 0);
      if (
        approvedLines.some((item) => item.line.productClass === "cut_hose") &&
        factoryEvidence?.precut !== true
      )
        throw new Response(
          "Cut-hose cancellation requires documented pre-cut factory facts",
          { status: 409 },
        );
      for (const item of approvedLines) {
        const shipment = orderFacts.shipments.find(
          (candidate) => candidate.id === item.line.shipmentId,
        );
        if (
          item.line.shipmentId &&
          (!shipment ||
            shipment.handedOff ||
            !["planned", "ready_to_ship"].includes(shipment.status))
        )
          throw cancellationConflict();
      }
      const merchandiseByLine = new Map<
        string,
        { quantity: number; cents: number }
      >();
      const resolutionLines: ResolutionLine[] = decided.map((item) => {
        const orderLine = orderFacts.lines.find(
          (line) => line.lineId === item.line.lineId,
        )!;
        const already =
          (prior.get(orderLine.lineId)?.quantity ?? 0) +
          (merchandiseByLine.get(orderLine.lineId)?.quantity ?? 0);
        const merchandiseCents = cumulativeLineAmount(
          orderLine.lineTotalCents,
          orderLine.physicalQuantity,
          already,
          item.approved,
        );
        const current = merchandiseByLine.get(orderLine.lineId) ?? {
          quantity: 0,
          cents: 0,
        };
        merchandiseByLine.set(orderLine.lineId, {
          quantity: current.quantity + item.approved,
          cents: current.cents + merchandiseCents,
        });
        return {
          lineId: item.line.lineId,
          shipmentId: item.line.shipmentId,
          displayName: item.line.displayName,
          requestedQuantity: item.line.physicalQuantity,
          approvedQuantity: item.approved,
          declinedQuantity: item.line.physicalQuantity - item.approved,
          merchandiseCents,
        };
      });
      const anyApproved = approvedLines.length > 0;
      const cutLines = orderFacts.lines.filter(
        (line) => line.productClass === "cut_hose",
      );
      const approvedPieces = approvedLines
        .filter((item) => item.line.productClass === "cut_hose")
        .reduce((sum, item) => sum + item.approved, 0);
      const serviceFee = approvedPieces
        ? {
            cents: cumulativeLineAmount(
              orderFacts.charges.cuttingLabeling ?? 0,
              cutLines.reduce((sum, line) => sum + line.physicalQuantity, 0),
              cutLines.reduce(
                (sum, line) => sum + (prior.get(line.lineId)?.quantity ?? 0),
                0,
              ),
              approvedPieces,
            ),
            note: `Cutting & Labeling Fee reversed in full for ${approvedPieces} uncut piece(s)`,
          }
        : null;
      const refund = refundComponents({
        merchandiseCents: resolutionLines.reduce(
          (sum, line) => sum + line.merchandiseCents,
          0,
        ),
        logisticsCents: anyApproved ? (input.logisticsCents ?? 0) : 0,
        taxCents: anyApproved ? (input.taxCents ?? 0) : 0,
        serviceFeeCents: serviceFee?.cents ?? 0,
        thirdPartyCostCents: anyApproved ? (input.thirdPartyCostCents ?? 0) : 0,
      });
      if (
        !anyApproved &&
        (input.logisticsCents || input.taxCents || input.thirdPartyCostCents)
      )
        throw new Response("A declined request has no refund components", {
          status: 400,
        });
      if (refund.logisticsCents > 0 && !logisticsNote)
        throw new Response("Explain the recoverable logistics amount", {
          status: 400,
        });
      if (refund.taxCents > 0 && !taxNote)
        throw new Response("Record the accepted tax basis", { status: 400 });
      if (refund.thirdPartyCostCents > 0 && !thirdPartyCostEvidence)
        throw new Response("Document the non-refundable third-party cost", {
          status: 400,
        });
      const outcome = !anyApproved
        ? "declined"
        : decided.every((item) => item.approved === item.line.physicalQuantity)
          ? "approved"
          : "partially_approved";
      const financial: ResolutionFinancial = {
        merchandiseCents: refund.merchandiseCents,
        logisticsCents: refund.logisticsCents,
        logisticsNote,
        taxCents: refund.taxCents,
        taxNote,
        serviceFeeCents: refund.serviceFeeCents,
        serviceFeeNote: serviceFee?.note ?? null,
        thirdPartyCostCents: refund.thirdPartyCostCents,
        thirdPartyCostEvidence,
        grossCents: refund.grossCents,
        refundCents: refund.refundCents,
      };
      const resolutionId = crypto.randomUUID();
      const authorizationId =
        refund.refundCents > 0 ? crypto.randomUUID() : null;
      const timestamp = now();
      const resolved = {
        sql: "EXISTS(SELECT 1 FROM order_cancellation_resolutions WHERE id=?)",
        bindings: [resolutionId],
      };
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE order_cancellation_requests
             SET status='resolved',version=version+1,updated_at=?
             WHERE id=? AND order_id=? AND version=? AND status='pending_review'`,
          )
          .bind(timestamp, request.id, request.order_id, input.expectedVersion),
        db
          .prepare(
            `INSERT INTO order_cancellation_resolutions
             (id,request_id,order_id,outcome,customer_reason,internal_note,lines_json,
              financial_json,factory_evidence_json,refund_authorization_id,actor_id,
              decided_at,command_id,command_hash)
             SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1`,
          )
          .bind(
            resolutionId,
            request.id,
            request.order_id,
            outcome,
            customerReason,
            internalNote,
            JSON.stringify(resolutionLines),
            JSON.stringify(financial),
            factoryEvidence ? JSON.stringify(factoryEvidence) : null,
            authorizationId,
            actor.id,
            timestamp,
            commandId,
            commandHash,
          ),
        db
          .prepare(
            `UPDATE order_quantity_holds SET active=0,resolved_at=?
             WHERE active=1 AND id IN (SELECT hold_id
               FROM order_cancellation_request_lines WHERE request_id=?)
               AND ${resolved.sql}`,
          )
          .bind(timestamp, request.id, ...resolved.bindings),
      ];
      for (const line of resolutionLines.filter(
        (item) => item.approvedQuantity,
      ))
        statements.push(
          db
            .prepare(
              `INSERT INTO order_cancelled_quantities
               (resolution_id,order_id,line_id,shipment_id,physical_quantity)
               SELECT ?,?,?,?,? WHERE ${resolved.sql}`,
            )
            .bind(
              resolutionId,
              request.order_id,
              line.lineId,
              line.shipmentId,
              line.approvedQuantity,
              ...resolved.bindings,
            ),
        );
      const scoped = resolutionLines.filter(
        (item) => item.approvedQuantity && item.shipmentId,
      );
      const shipmentIds = [...new Set(scoped.map((line) => line.shipmentId))];
      if (scoped.length) {
        statements.push(
          db
            .prepare(
              `INSERT INTO order_cancellation_allocation_edit_context(order_id,resolution_id)
               SELECT ?,? WHERE ${resolved.sql}`,
            )
            .bind(request.order_id, resolutionId, ...resolved.bindings),
        );
        for (const line of scoped) {
          const allocation = orderFacts.shipments
            .find((shipment) => shipment.id === line.shipmentId)!
            .allocations.find((item) => item.lineId === line.lineId)!;
          const remaining = allocation.physicalQuantity - line.approvedQuantity;
          statements.push(
            db
              .prepare(
                `DELETE FROM order_shipment_allocations
                 WHERE shipment_id=? AND line_id=? AND physical_quantity=?
                   AND EXISTS(SELECT 1 FROM order_cancellation_allocation_edit_context
                     WHERE order_id=? AND resolution_id=?)`,
              )
              .bind(
                line.shipmentId,
                line.lineId,
                allocation.physicalQuantity,
                request.order_id,
                resolutionId,
              ),
          );
          if (remaining > 0)
            statements.push(
              db
                .prepare(
                  `INSERT INTO order_shipment_allocations
                   (shipment_id,order_id,line_id,physical_quantity)
                   SELECT ?,?,?,? WHERE changes()=1`,
                )
                .bind(
                  line.shipmentId,
                  request.order_id,
                  line.lineId,
                  remaining,
                ),
            );
        }
        // Each touched Shipment moves from the version this decision read;
        // a concurrent decision on the same Shipment aborts the batch.
        for (const shipmentId of shipmentIds) {
          const shipment = orderFacts.shipments.find(
            (candidate) => candidate.id === shipmentId,
          )!;
          statements.push(
            db
              .prepare(
                `UPDATE order_shipments SET version=version+1,updated_at=?
                 WHERE order_id=? AND id=? AND version=? AND ${resolved.sql}`,
              )
              .bind(
                timestamp,
                request.order_id,
                shipmentId,
                shipment.version,
                ...resolved.bindings,
              ),
            db
              .prepare(
                `INSERT INTO after_sales_batch_assertions(failed)
                 SELECT 1 WHERE changes()!=1 AND ${resolved.sql}`,
              )
              .bind(...resolved.bindings),
          );
        }
        statements.push(
          db
            .prepare(
              `DELETE FROM order_cancellation_allocation_edit_context
               WHERE order_id=? AND resolution_id=?`,
            )
            .bind(request.order_id, resolutionId),
        );
      }
      let deadline: { dateEt: string } | null = null;
      let refundStatus: string | null = null;
      if (authorizationId) {
        const authorization = refundAuthorizationStatements(db, {
          id: authorizationId,
          orderId: request.order_id,
          sourceKind: "cancellation",
          sourceId: resolutionId,
          responsibility: "customer",
          refund,
          thirdPartyCostEvidence,
          lineCredits: [...merchandiseByLine].map(([lineId, value]) => ({
            lineId,
            physicalQuantity: value.quantity,
            merchandiseCents: value.cents,
          })),
          actorId: actor.id,
          timestamp,
          commandId,
          guard: resolved,
        });
        statements.push(...authorization.statements);
        deadline = authorization.deadline;
        refundStatus = authorization.status;
      }
      const eventId = `cancellation-resolved:${commandId}`;
      statements.push(
        db
          .prepare(
            `INSERT INTO order_cancellation_events
             (id,request_id,kind,details_json,actor_id,occurred_at,command_id)
             SELECT ?,?,'resolved',?,?,?,? WHERE ${resolved.sql}`,
          )
          .bind(
            eventId,
            request.id,
            JSON.stringify({ resolutionId, outcome }),
            actor.id,
            timestamp,
            commandId,
            ...resolved.bindings,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'order.cancellation_resolved','confirmed_order',?,?,?,?
             WHERE ${resolved.sql}`,
          )
          .bind(
            eventId,
            request.order_id,
            actor.id,
            JSON.stringify({
              requestId: request.id,
              resolutionId,
              outcome,
              lines: resolutionLines,
              financial,
              refundAuthorizationId: authorizationId,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
            ...resolved.bindings,
          ),
      );
      const outcomeText =
        outcome === "approved"
          ? "was approved"
          : outcome === "partially_approved"
            ? "was partially approved"
            : "was declined";
      const lineText = resolutionLines
        .map(
          (line) =>
            `${line.displayName}: ${line.approvedQuantity} of ${line.requestedQuantity} cancelled`,
        )
        .join("; ");
      const refundText = !authorizationId
        ? "No refund is due from this decision."
        : refundStatus === "approved"
          ? `Refund approved: ${usd(refund.refundCents)} (merchandise ${usd(refund.merchandiseCents)}${refund.logisticsCents ? `, logistics ${usd(refund.logisticsCents)}` : ""}${refund.taxCents ? `, Sales Tax ${usd(refund.taxCents)}` : ""}${refund.serviceFeeCents ? `, service fee ${usd(refund.serviceFeeCents)}` : ""}). It has not been sent yet; we will initiate it by ${etDisplayDate(deadline!.dateEt)} ET and record the date here.`
          : `Proposed refund: gross ${usd(refund.grossCents)} less documented third-party cost ${usd(refund.thirdPartyCostCents)} = ${usd(refund.refundCents)}. Please review and confirm or dispute this amount in your Order.`;
      statements.push(
        ...(await customerMessageStatements(db, {
          orderRequestId: orderFacts.requestId,
          actorId: actor.id,
          messageId: `cancellation-decision:${commandId}`,
          body: `Your cancellation request for Order ${orderFacts.orderNumber} ${outcomeText}. ${lineText}. Reason: ${customerReason} ${refundText}${request.kind === "exceptional" ? " The approved specification is not edited; a corrected assembly or new length requires a separate Follow-on Quote, PI, payment and Order." : ""} Your original PI and Order records are unchanged.`,
          timestamp,
          guard: resolved,
        })),
      );
      try {
        const results = await db.batch(statements);
        if (results[0].meta.changes !== 1) throw cancellationConflict();
      } catch (error) {
        const concurrent = await db
          .prepare(
            `SELECT id,command_hash FROM order_cancellation_resolutions WHERE command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; command_hash: string }>();
        if (concurrent?.command_hash === commandHash) return concurrent.id;
        if (error instanceof Response) throw error;
        const message = error instanceof Error ? error.message : "";
        if (/funds|exceed|Payment review/i.test(message))
          throw new Response(message.replace(/^.*?: /, ""), { status: 409 });
        throw cancellationConflict();
      }
      return resolutionId;
    },

    async customerRespondToRefund(
      profileId: string,
      input: {
        orderId: string;
        authorizationId: string;
        expectedVersion: number;
        response: "confirm" | "dispute";
        note?: string;
        commandId: string;
      },
    ) {
      const commandId = afterSalesCommandId(input.commandId);
      const orderId = await facts.ownedOrder(profileId, input.orderId);
      if (!["confirm", "dispute"].includes(input.response))
        throw new Response("Invalid response", { status: 400 });
      const note =
        input.response === "dispute"
          ? afterSalesText(input.note, "What should be reviewed")
          : null;
      const eventId = `refund-response:${commandId}`;
      const replay = await db
        .prepare(
          `SELECT authorization_id,actor_id FROM after_sales_refund_events WHERE id=?`,
        )
        .bind(eventId)
        .first<{ authorization_id: string; actor_id: string }>();
      if (replay) {
        if (
          replay.authorization_id !== input.authorizationId ||
          replay.actor_id !== profileId
        )
          throw cancellationConflict();
        return;
      }
      const [authorization] = await readRefundAuthorizations(db, {
        ids: [input.authorizationId],
      });
      if (!authorization || authorization.order_id !== orderId)
        throw new Response("Refund not found", { status: 404 });
      if (
        authorization.version !== input.expectedVersion ||
        !["awaiting_customer_confirmation", "disputed"].includes(
          authorization.status,
        ) ||
        (input.response === "dispute" &&
          authorization.status !== "awaiting_customer_confirmation")
      )
        throw cancellationConflict();
      const timestamp = now();
      const deadline =
        input.response === "confirm"
          ? refundInitiationDeadline(timestamp)
          : null;
      const orderFacts = await facts.read(orderId);
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE after_sales_refund_authorizations
             SET status=?,version=version+1,approved_at=?,deadline_date_et=?,
               deadline_at=?,calendar_version=?,customer_response_at=?,
               customer_response_by=?
             WHERE id=? AND order_id=? AND version=?`,
          )
          .bind(
            input.response === "confirm" ? "approved" : "disputed",
            deadline ? timestamp : null,
            deadline?.dateEt ?? null,
            deadline?.at ?? null,
            deadline?.calendarVersion ?? null,
            timestamp,
            profileId,
            authorization.id,
            orderId,
            input.expectedVersion,
          ),
        db
          .prepare(
            `INSERT INTO after_sales_refund_events
             (id,authorization_id,kind,details_json,actor_id,occurred_at,command_id)
             SELECT ?,?,?,?,?,?,? WHERE changes()=1`,
          )
          .bind(
            eventId,
            authorization.id,
            input.response === "confirm"
              ? "customer_confirmed"
              : "customer_disputed",
            JSON.stringify({ note, refundCents: authorization.refund_cents }),
            profileId,
            timestamp,
            commandId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,?,'confirmed_order',?,?,?,?
             WHERE EXISTS(SELECT 1 FROM after_sales_refund_events WHERE id=?)`,
          )
          .bind(
            eventId,
            input.response === "confirm"
              ? "order.refund_customer_confirmed"
              : "order.refund_customer_disputed",
            orderId,
            profileId,
            JSON.stringify({
              authorizationId: authorization.id,
              note,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
            eventId,
          ),
      ];
      if (deadline)
        statements.push(
          ...(await customerMessageStatements(db, {
            orderRequestId: orderFacts.requestId,
            actorId: "system",
            messageId: `refund-confirmed:${commandId}`,
            body: `Thank you. Your refund of ${usd(authorization.refund_cents)} for Order ${orderFacts.orderNumber} is approved. It has not been sent yet; we will initiate it by ${etDisplayDate(deadline.dateEt)} ET.`,
            timestamp,
            guard: {
              sql: "EXISTS(SELECT 1 FROM after_sales_refund_events WHERE id=?)",
              bindings: [eventId],
            },
          })),
        );
      try {
        const results = await db.batch(statements);
        if (results[0].meta.changes !== 1) throw cancellationConflict();
      } catch (error) {
        if (error instanceof Response) throw error;
        throw cancellationConflict();
      }
    },
  };
}

export type CancellationService = ReturnType<typeof createCancellationService>;
export type CancellationRequestView = Awaited<
  ReturnType<CancellationService["adminRead"]>
>[number];
