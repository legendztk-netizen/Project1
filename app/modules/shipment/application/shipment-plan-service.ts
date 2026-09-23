import type { AdminIdentity } from "#workers/admin-access";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import {
  piSha256,
  type ProformaInvoiceSnapshot,
} from "../../proforma-invoice/domain/proforma-invoice";
import {
  validatedShipmentGroups,
  type QuotedShipmentGroup,
} from "../domain/shipment-plan";

interface PlanRow {
  order_id: string;
  status: "ready" | "review";
  source: string;
  source_text: string;
  review_note: string | null;
  version: number;
  snapshot_json: string;
  snapshot_hash: string;
  held: number;
}

interface ShipmentRow {
  id: string;
  group_key: string;
  sequence_number: number;
  display_name: string;
  accepted_terms_json: string;
  status: "planned" | "ready_to_ship" | "shipped" | "delivered";
  version: number;
}

interface AllocationRow {
  shipment_id: string;
  line_id: string;
  physical_quantity: number;
  display_name: string;
  sku: string;
  line_kind: string;
  sales_unit: string;
  original_length_value: number | null;
  original_length_unit: string | null;
}

function assertAdmin(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}

async function verifiedSnapshot(row: PlanRow) {
  if (
    (await piSha256(new TextEncoder().encode(row.snapshot_json))) !==
    row.snapshot_hash
  )
    throw new Response("Order snapshot integrity failure", { status: 409 });
  return JSON.parse(row.snapshot_json) as ProformaInvoiceSnapshot;
}

async function readPlan(db: D1Database, row: PlanRow, admin: boolean) {
  const snapshot = await verifiedSnapshot(row);
  const shipments = (
    await db
      .prepare(
        `SELECT id,group_key,sequence_number,display_name,accepted_terms_json,status,version
         FROM order_shipments WHERE order_id=? ORDER BY sequence_number`,
      )
      .bind(row.order_id)
      .all<ShipmentRow>()
  ).results;
  const allocations = (
    await db
      .prepare(
        `SELECT a.shipment_id,a.line_id,a.physical_quantity,
           json_extract(l.snapshot_json,'$.displayName') AS display_name,
           json_extract(l.snapshot_json,'$.sku') AS sku,
           l.line_kind,
           json_extract(l.snapshot_json,'$.salesUnit') AS sales_unit,
           json_extract(l.snapshot_json,'$.lengthOrder.originalLengthValue') AS original_length_value,
           json_extract(l.snapshot_json,'$.lengthOrder.originalLengthUnit') AS original_length_unit
         FROM order_shipment_allocations a
         JOIN confirmed_order_lines l ON l.order_id=a.order_id AND l.line_id=a.line_id
         WHERE a.order_id=? ORDER BY a.shipment_id,l.line_number`,
      )
      .bind(row.order_id)
      .all<AllocationRow>()
  ).results;
  const holds = (
    await db
      .prepare(
        `SELECT shipment_id,line_id,sum(physical_quantity) AS quantity
         FROM order_quantity_holds WHERE order_id=? AND active=1
         GROUP BY shipment_id,line_id`,
      )
      .bind(row.order_id)
      .all<{
        shipment_id: string | null;
        line_id: string;
        quantity: number;
      }>()
  ).results;
  return {
    orderId: row.order_id,
    status: row.status,
    version: row.version,
    paymentHeld: row.held === 1,
    originalMode: snapshot.terms.shipmentMode,
    originalSplitPlan: snapshot.terms.splitPlan,
    originalCharges: snapshot.terms.charges,
    originalTerms: {
      incoterm: snapshot.terms.incoterm,
      namedPlace: snapshot.terms.namedPlace,
      transportMethod: snapshot.terms.transportMethod,
    },
    ...(admin
      ? {
          source: row.source,
          sourceText: row.source_text,
          reviewNote: row.review_note,
          lines: snapshot.lines.map((line) => ({
            id: line.id,
            sku: line.sku,
            displayName: line.displayName,
            lineKind: line.lineKind,
            quantity:
              line.lineKind === "length_based_hose"
                ? line.lengthOrder?.pieceCount
                : line.quantity,
            unit:
              line.lineKind === "length_based_hose" ? "pieces" : line.salesUnit,
          })),
        }
      : {}),
    shipments: shipments.map((shipment) => {
      const group = JSON.parse(
        shipment.accepted_terms_json,
      ) as QuotedShipmentGroup;
      return {
        id: shipment.id,
        groupKey: shipment.group_key,
        sequenceNumber: shipment.sequence_number,
        displayName: shipment.display_name,
        status: shipment.status,
        version: shipment.version,
        freightCents: group.freightCents,
        insuranceCents: group.insuranceCents,
        dutiesImportCents: group.dutiesImportCents,
        transportMethod: group.transportMethod,
        incoterm: group.incoterm,
        namedPlace: group.namedPlace,
        held:
          row.held === 1 ||
          holds.some(
            (hold) =>
              hold.shipment_id === shipment.id ||
              (hold.shipment_id === null &&
                allocations.some(
                  (allocation) =>
                    allocation.shipment_id === shipment.id &&
                    allocation.line_id === hold.line_id,
                )),
          ),
        allocations: allocations
          .filter((allocation) => allocation.shipment_id === shipment.id)
          .map((allocation) => ({
            lineId: allocation.line_id,
            displayName: allocation.display_name,
            sku: allocation.sku,
            lineKind: allocation.line_kind,
            physicalQuantity: allocation.physical_quantity,
            unit:
              allocation.line_kind === "length_based_hose"
                ? "pieces"
                : allocation.sales_unit,
            lengthPerPiece:
              allocation.line_kind === "length_based_hose"
                ? {
                    value: allocation.original_length_value,
                    unit: allocation.original_length_unit,
                  }
                : null,
          })),
      };
    }),
  };
}

export function createShipmentPlanService(db: D1Database) {
  async function adminRow(actor: AdminIdentity, orderId: string) {
    assertAdmin(actor);
    const row = await db
      .prepare(
        `SELECT p.*,o.snapshot_json,o.snapshot_hash,coalesce(guard.held,0) AS held
         FROM order_fulfillment_plans p
         JOIN confirmed_orders o ON o.id=p.order_id
         LEFT JOIN order_release_guards guard ON guard.order_id=o.id
         WHERE p.order_id=?`,
      )
      .bind(orderId)
      .first<PlanRow>();
    if (!row)
      throw new Response("Order shipment plan not found", { status: 404 });
    return row;
  }

  return {
    async adminRead(actor: AdminIdentity, orderId: string) {
      return readPlan(db, await adminRow(actor, orderId), true);
    },
    async customerRead(profileId: string, orderId: string) {
      if (!profileId) throw new Response("Forbidden", { status: 403 });
      const row = await db
        .prepare(
          `SELECT p.*,o.snapshot_json,o.snapshot_hash,coalesce(guard.held,0) AS held
           FROM order_fulfillment_plans p
           JOIN confirmed_orders o ON o.id=p.order_id
           LEFT JOIN order_release_guards guard ON guard.order_id=o.id
           JOIN customer_quote_requests request ON request.id=o.request_id
           ${ownedQuoteRequestWhere} AND o.id=?`,
        )
        .bind(profileId, profileId, profileId, orderId)
        .first<PlanRow>();
      if (!row)
        throw new Response("Order shipment plan not found", { status: 404 });
      return readPlan(db, row, false);
    },
    async mapHistoricalSplit(
      actor: AdminIdentity,
      input: {
        orderId: string;
        expectedVersion: number;
        commandId: string;
        groups: QuotedShipmentGroup[];
        reviewNote: string;
        matchesAcceptedTerms: boolean;
      },
    ) {
      const row = await adminRow(actor, input.orderId);
      if (!/^[0-9a-f-]{36}$/.test(input.commandId))
        throw new Response("Command identity required", { status: 400 });
      const note = input.reviewNote.trim();
      if (
        input.matchesAcceptedTerms !== true ||
        note.length < 10 ||
        note.length > 2000
      )
        throw new Response("Accepted-plan review and evidence required", {
          status: 400,
        });
      const snapshot = await verifiedSnapshot(row);
      if (
        snapshot.terms.shipmentMode !== "split" ||
        snapshot.terms.shipmentGroups?.length ||
        !snapshot.terms.splitPlan?.trim() ||
        !["historical_review", "reviewed_mapping"].includes(row.source)
      )
        throw new Response("This plan needs the accepted Order terms", {
          status: 409,
        });
      const groups = validatedShipmentGroups(snapshot.lines, {
        shipmentMode: "split",
        shipmentGroups: input.groups,
        transportMethod: snapshot.terms.transportMethod,
        incoterm: snapshot.terms.incoterm,
        namedPlace: snapshot.terms.namedPlace,
        charges: snapshot.terms.charges,
      });
      const payloadHash = await piSha256(
        new TextEncoder().encode(
          JSON.stringify({ orderId: input.orderId, groups, note }),
        ),
      );
      const replay = async () => {
        const receipt = await db
          .prepare(
            "SELECT actor_id,payload_hash,resulting_version FROM order_shipment_plan_commands WHERE id=?",
          )
          .bind(input.commandId)
          .first<{
            actor_id: string;
            payload_hash: string;
            resulting_version: number;
          }>();
        if (!receipt) return null;
        if (
          receipt.actor_id !== actor.id ||
          receipt.payload_hash !== payloadHash
        )
          throw new Response("Command identity conflict", { status: 409 });
        return receipt.resulting_version;
      };
      const prior = await replay();
      if (prior !== null) return prior;
      if (row.version !== input.expectedVersion || row.held)
        throw new Response("Plan changed or payment review is active", {
          status: 409,
        });
      const now = new Date().toISOString();
      const groupsJson = JSON.stringify(groups);
      try {
        await db.batch([
          db
            .prepare(
              `UPDATE order_fulfillment_plans SET status='ready',source='reviewed_mapping',
                 review_note=?,reviewed_by=?,version=version+1,updated_at=?
               WHERE order_id=? AND version=?
                 AND NOT EXISTS(SELECT 1 FROM order_release_guards guard
                   WHERE guard.order_id=? AND guard.held=1)
                 AND NOT EXISTS(SELECT 1 FROM order_quantity_holds hold
                   WHERE hold.order_id=? AND hold.active=1)
                 AND NOT EXISTS(SELECT 1 FROM order_shipments shipment
                   WHERE shipment.order_id=? AND shipment.status!='planned')`,
            )
            .bind(
              note,
              actor.id,
              now,
              input.orderId,
              input.expectedVersion,
              input.orderId,
              input.orderId,
              input.orderId,
            ),
          db
            .prepare(
              `INSERT INTO order_shipment_plan_commands(id,order_id,actor_id,payload_hash,resulting_version,created_at)
               SELECT ?,?,?,?,?,? WHERE changes()=1`,
            )
            .bind(
              input.commandId,
              input.orderId,
              actor.id,
              payloadHash,
              input.expectedVersion + 1,
              now,
            ),
          db
            .prepare(
              `DELETE FROM order_shipment_allocations WHERE order_id=?
               AND EXISTS(SELECT 1 FROM order_shipment_plan_commands WHERE id=?)`,
            )
            .bind(input.orderId, input.commandId),
          db
            .prepare(
              `DELETE FROM order_shipments WHERE order_id=?
               AND EXISTS(SELECT 1 FROM order_shipment_plan_commands WHERE id=?)`,
            )
            .bind(input.orderId, input.commandId),
          db
            .prepare(
              `INSERT INTO order_shipments(id,order_id,group_key,sequence_number,display_name,
                 accepted_terms_json,created_at,updated_at)
               SELECT 'shipment:'||?||':'||json_extract(g.value,'$.id'),?,
                 json_extract(g.value,'$.id'),CAST(g.key AS INTEGER)+1,
                 json_extract(g.value,'$.label'),g.value,?,?
               FROM json_each(?) g
               WHERE EXISTS(SELECT 1 FROM order_shipment_plan_commands WHERE id=?)`,
            )
            .bind(
              input.orderId,
              input.orderId,
              now,
              now,
              groupsJson,
              input.commandId,
            ),
          db
            .prepare(
              `INSERT INTO order_shipment_allocations(shipment_id,order_id,line_id,physical_quantity)
               SELECT s.id,s.order_id,json_extract(a.value,'$.lineId'),
                 json_extract(a.value,'$.physicalQuantity')
               FROM order_shipments s,json_each(s.accepted_terms_json,'$.allocations') a
               WHERE s.order_id=? AND EXISTS(SELECT 1 FROM order_shipment_plan_commands WHERE id=?)`,
            )
            .bind(input.orderId, input.commandId),
          db
            .prepare(
              `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
               SELECT ?,'shipment.plan_mapped','confirmed_order',?,?,?,?
               WHERE EXISTS(SELECT 1 FROM order_shipment_plan_commands WHERE id=?)`,
            )
            .bind(
              `shipment-plan:${input.commandId}`,
              input.orderId,
              actor.id,
              JSON.stringify({
                priorVersion: input.expectedVersion,
                currentVersion: input.expectedVersion + 1,
                originalPlan: snapshot.terms.splitPlan,
                groups,
                reviewNote: note,
              }),
              now,
              input.commandId,
            ),
        ]);
      } catch (error) {
        const completed = await replay();
        if (completed !== null) return completed;
        throw error;
      }
      const completed = await replay();
      if (completed === null)
        throw new Response("Plan changed or release is held", { status: 409 });
      return completed;
    },
  };
}
