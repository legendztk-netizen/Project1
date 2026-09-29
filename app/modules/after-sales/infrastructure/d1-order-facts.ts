import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import {
  physicalQuantity,
  returnProductClass,
  type ReturnProductClass,
} from "../domain/return-policy";

export interface OrderLineFact {
  lineId: string;
  lineNumber: number;
  lineKind: string;
  sku: string;
  displayName: string;
  productClass: ReturnProductClass;
  physicalQuantity: number;
  /** Frozen per-piece length for cut hose; never pricing footage. */
  pieceLengthFt: number | null;
  lineTotalCents: number;
}

export interface ShipmentFact {
  id: string;
  displayName: string;
  sequenceNumber: number;
  status: "planned" | "ready_to_ship" | "shipped" | "delivered";
  version: number;
  handedOff: boolean;
  deliveredDate: string | null;
  deliveredRecordedAt: string | null;
  allocations: Array<{ lineId: string; physicalQuantity: number }>;
}

export interface HoldFact {
  id: string;
  lineId: string;
  shipmentId: string | null;
  physicalQuantity: number;
  kind: string;
}

export interface OrderFacts {
  orderId: string;
  orderNumber: string;
  requestId: string;
  purchasingContextId: string;
  charges: Record<string, number>;
  lines: OrderLineFact[];
  shipments: ShipmentFact[];
  activeHolds: HoldFact[];
  // Physical units already removed by Cancellation Resolutions, per line.
  cancelledByLine: Map<string, number>;
}

interface LineRow {
  line_id: string;
  line_number: number;
  line_kind: string;
  snapshot_json: string;
}

export function createD1OrderFacts(db: D1Database) {
  async function ownedOrder(profileId: string, orderId: string) {
    if (!profileId) throw new Response("Forbidden", { status: 403 });
    const row = await db
      .prepare(
        `SELECT o.id FROM confirmed_orders o
         JOIN customer_quote_requests request ON request.id=o.request_id
         ${ownedQuoteRequestWhere} AND o.id=?`,
      )
      .bind(profileId, profileId, profileId, orderId)
      .first<{ id: string }>();
    if (!row) throw new Response("Order not found", { status: 404 });
    return row.id;
  }

  async function read(orderId: string): Promise<OrderFacts> {
    const order = await db
      .prepare(
        `SELECT id,order_number,request_id,purchasing_context_id,snapshot_json
         FROM confirmed_orders WHERE id=?`,
      )
      .bind(orderId)
      .first<{
        id: string;
        order_number: string;
        request_id: string;
        purchasing_context_id: string;
        snapshot_json: string;
      }>();
    if (!order) throw new Response("Order not found", { status: 404 });
    const [
      lines,
      shipments,
      allocations,
      holds,
      dispatched,
      delivered,
      cancelled,
    ] = await Promise.all([
      db
        .prepare(
          `SELECT line_id,line_number,line_kind,snapshot_json
             FROM confirmed_order_lines WHERE order_id=? ORDER BY line_number`,
        )
        .bind(orderId)
        .all<LineRow>(),
      db
        .prepare(
          `SELECT id,display_name,sequence_number,status,version
             FROM order_shipments WHERE order_id=? ORDER BY sequence_number`,
        )
        .bind(orderId)
        .all<{
          id: string;
          display_name: string;
          sequence_number: number;
          status: ShipmentFact["status"];
          version: number;
        }>(),
      db
        .prepare(
          `SELECT shipment_id,line_id,physical_quantity
             FROM order_shipment_allocations WHERE order_id=?`,
        )
        .bind(orderId)
        .all<{
          shipment_id: string;
          line_id: string;
          physical_quantity: number;
        }>(),
      db
        .prepare(
          `SELECT id,line_id,shipment_id,physical_quantity,kind
             FROM order_quantity_holds WHERE order_id=? AND active=1`,
        )
        .bind(orderId)
        .all<{
          id: string;
          line_id: string;
          shipment_id: string | null;
          physical_quantity: number;
          kind: string;
        }>(),
      db
        .prepare(
          `SELECT DISTINCT shipment_id FROM shipment_dispatch_quantities
             WHERE order_id=?`,
        )
        .bind(orderId)
        .all<{ shipment_id: string }>(),
      db
        .prepare(
          `SELECT shipment_id,actual_date,recorded_at FROM shipment_milestone_events
             WHERE order_id=? AND kind='delivered'`,
        )
        .bind(orderId)
        .all<{
          shipment_id: string;
          actual_date: string;
          recorded_at: string;
        }>(),
      db
        .prepare(
          `SELECT line_id,sum(physical_quantity) AS quantity
             FROM order_cancelled_quantities WHERE order_id=? GROUP BY line_id`,
        )
        .bind(orderId)
        .all<{ line_id: string; quantity: number }>(),
    ]);
    const snapshot = JSON.parse(order.snapshot_json) as {
      conditions?: {
        madeToOrderAcknowledgements?: Array<{ lineId: string }>;
      };
      terms?: { charges?: Record<string, number | null> };
    };
    const acknowledged = new Set(
      (snapshot.conditions?.madeToOrderAcknowledgements ?? []).map(
        (item) => item.lineId,
      ),
    );
    const handedOff = new Set(dispatched.results.map((row) => row.shipment_id));
    return {
      orderId: order.id,
      orderNumber: order.order_number,
      requestId: order.request_id,
      purchasingContextId: order.purchasing_context_id,
      charges: Object.fromEntries(
        Object.entries(snapshot.terms?.charges ?? {}).map(([key, value]) => [
          key,
          typeof value === "number" && Number.isSafeInteger(value) ? value : 0,
        ]),
      ),
      lines: lines.results.map((row) => {
        const line = JSON.parse(row.snapshot_json) as {
          sku?: string;
          displayName?: string;
          quantity?: number;
          madeToOrder?: boolean;
          lengthOrder?: {
            pieceCount?: number;
            normalizedLengthFt?: number;
          } | null;
          totals?: { totalCents?: number };
        };
        const facts = { ...line, lineKind: row.line_kind };
        return {
          lineId: row.line_id,
          lineNumber: row.line_number,
          lineKind: row.line_kind,
          sku: line.sku ?? "",
          displayName: line.displayName ?? line.sku ?? row.line_id,
          productClass: returnProductClass(
            facts,
            acknowledged.has(row.line_id),
          ),
          physicalQuantity: physicalQuantity(facts),
          pieceLengthFt:
            row.line_kind === "length_based_hose"
              ? (line.lengthOrder?.normalizedLengthFt ?? null)
              : null,
          lineTotalCents: line.totals?.totalCents ?? 0,
        };
      }),
      shipments: shipments.results.map((row) => {
        const delivery = delivered.results.find(
          (item) => item.shipment_id === row.id,
        );
        return {
          id: row.id,
          displayName: row.display_name,
          sequenceNumber: row.sequence_number,
          status: row.status,
          version: row.version,
          handedOff: handedOff.has(row.id),
          deliveredDate: delivery?.actual_date ?? null,
          deliveredRecordedAt: delivery?.recorded_at ?? null,
          allocations: allocations.results
            .filter((item) => item.shipment_id === row.id)
            .map((item) => ({
              lineId: item.line_id,
              physicalQuantity: item.physical_quantity,
            })),
        };
      }),
      activeHolds: holds.results.map((row) => ({
        id: row.id,
        lineId: row.line_id,
        shipmentId: row.shipment_id,
        physicalQuantity: row.physical_quantity,
        kind: row.kind,
      })),
      cancelledByLine: new Map(
        cancelled.results.map((row) => [row.line_id, row.quantity]),
      ),
    };
  }

  return { ownedOrder, read };
}

/** Unshipped quantities a customer may still ask to cancel, by Shipment. */
export function cancellableQuantities(
  facts: OrderFacts,
  productClasses: readonly OrderLineFact["productClass"][] = ["standard"],
) {
  const result: Array<{
    lineId: string;
    shipmentId: string | null;
    shipmentVersion: number | null;
    available: number;
  }> = [];
  for (const line of facts.lines) {
    if (!productClasses.includes(line.productClass)) continue;
    const allocated = facts.shipments.flatMap((shipment) =>
      shipment.allocations
        .filter((allocation) => allocation.lineId === line.lineId)
        .map((allocation) => ({ shipment, allocation })),
    );
    if (!allocated.length) {
      const held = facts.activeHolds
        .filter((hold) => hold.lineId === line.lineId)
        .reduce((sum, hold) => sum + hold.physicalQuantity, 0);
      const available =
        line.physicalQuantity -
        held -
        (facts.cancelledByLine.get(line.lineId) ?? 0);
      if (available > 0)
        result.push({
          lineId: line.lineId,
          shipmentId: null,
          shipmentVersion: null,
          available,
        });
      continue;
    }
    for (const { shipment, allocation } of allocated) {
      if (
        shipment.handedOff ||
        !["planned", "ready_to_ship"].includes(shipment.status)
      )
        continue;
      const held = facts.activeHolds
        .filter(
          (hold) =>
            hold.lineId === line.lineId && hold.shipmentId === shipment.id,
        )
        .reduce((sum, hold) => sum + hold.physicalQuantity, 0);
      const available = allocation.physicalQuantity - held;
      if (available > 0)
        result.push({
          lineId: line.lineId,
          shipmentId: shipment.id,
          shipmentVersion: shipment.version,
          available,
        });
    }
  }
  return result;
}
