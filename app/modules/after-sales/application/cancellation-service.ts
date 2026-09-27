import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { requireAfterSalesPermission } from "../domain/permissions";
import {
  cancellableQuantities,
  createD1OrderFacts,
  type OrderFacts,
} from "../infrastructure/d1-order-facts";

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

const hash = (value: string) => piSha256(new TextEncoder().encode(value));
export const cancellationConflict = () =>
  new Response("Cancellation state changed; reload", { status: 409 });

export function afterSalesText(value: unknown, label: string, maximum = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Response(`${label} required`, { status: 400 });
  return value.trim();
}

export function afterSalesCommandId(value: unknown) {
  const commandId = afterSalesText(value, "Command ID", 100);
  if (!/^[0-9a-f-]{36}$/i.test(commandId))
    throw new Response("Invalid command ID", { status: 400 });
  return commandId;
}

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
    const [lines, events] = await Promise.all([
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
    ]);
    return rows.map((row) => {
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
      };
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
  };
}

export type CancellationService = ReturnType<typeof createCancellationService>;
export type CancellationRequestView = Awaited<
  ReturnType<CancellationService["adminRead"]>
>[number];
