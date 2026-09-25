import type { AdminIdentity } from "#workers/admin-access";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { Temporal } from "@js-temporal/polyfill";
import {
  actualChinaDate,
  actualHandoffInstant,
  reviewedText,
  trackingDestination,
  verifiedReadiness,
  type ReadinessVerification,
  type ShipmentMilestone,
} from "../domain/shipment-milestones";

interface ShipmentRow {
  id: string;
  order_id: string;
  request_id: string;
  display_name: string;
  status: "planned" | "ready_to_ship" | "shipped" | "delivered";
  version: number;
  plan_status: "ready" | "review";
  payment_held: number;
}

interface MilestoneRow {
  id: string;
  kind: ShipmentMilestone;
  actual_date: string | null;
  actual_at: string | null;
  recorded_at: string;
  actor_id: string;
  details_json: string;
  command_id: string;
  payload_hash: string;
}

interface TrackingRow {
  id: string;
  package_label: string;
  carrier_name: string;
  tracking_number: string | null;
  tracking_url: string | null;
  estimated_arrival_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface LateReportRow {
  id: string;
  order_id: string;
  shipment_id: string;
  expected_shipment_version: number;
  reported_status: "planned" | "ready_to_ship";
  actual_at: string;
  actual_date: string;
  carrier_name: string;
  source: string;
  reason: string;
  quantities_json: string;
  actor_id: string;
  recorded_at: string;
  command_id: string;
  payload_hash: string;
}

function assertAdmin(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}

function commandIdentity(value: string) {
  if (!/^[0-9a-f-]{36}$/.test(value))
    throw new Response("Command identity required", { status: 400 });
}

function trackingProjection(row: TrackingRow) {
  return {
    id: row.id,
    packageLabel: row.package_label,
    carrierName: row.carrier_name,
    trackingNumber: row.tracking_number,
    trackingUrl: row.tracking_url,
    customerTrackingUrl: trackingDestination(row.tracking_url).customerUrl,
    estimatedArrivalDate: row.estimated_arrival_date,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createShipmentMilestoneService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string | null } = {},
) {
  const now = () => options.now?.() ?? new Date();

  async function shipment(orderId: string, shipmentId: string) {
    const row = await db
      .prepare(
        `SELECT s.id,s.order_id,o.request_id,s.display_name,s.status,s.version,
           p.status AS plan_status,coalesce(g.held,0) AS payment_held
         FROM order_shipments s JOIN confirmed_orders o ON o.id=s.order_id
         JOIN order_fulfillment_plans p ON p.order_id=o.id
         LEFT JOIN order_release_guards g ON g.order_id=o.id
         WHERE s.order_id=? AND s.id=?`,
      )
      .bind(orderId, shipmentId)
      .first<ShipmentRow>();
    if (!row) throw new Response("Shipment not found", { status: 404 });
    return row;
  }

  async function owned(profileId: string, orderId: string) {
    if (!profileId) throw new Response("Forbidden", { status: 403 });
    const row = await db
      .prepare(
        `SELECT o.id FROM confirmed_orders o
         JOIN customer_quote_requests request ON request.id=o.request_id
         ${ownedQuoteRequestWhere} AND o.id=?`,
      )
      .bind(profileId, profileId, profileId, orderId)
      .first();
    if (!row) throw new Response("Order not found", { status: 404 });
  }

  async function read(orderId: string, isAdmin: boolean) {
    const shipments = (
      await db
        .prepare(
          `SELECT s.id,s.display_name,s.status,s.version FROM order_shipments s
           WHERE s.order_id=? ORDER BY s.sequence_number`,
        )
        .bind(orderId)
        .all<Pick<ShipmentRow, "id" | "display_name" | "status" | "version">>()
    ).results;
    const events = (
      await db
        .prepare(
          `SELECT id,shipment_id,kind,actual_date,actual_at,recorded_at,actor_id,
             details_json,command_id,payload_hash FROM shipment_milestone_events
           WHERE order_id=? ORDER BY shipment_id,
             CASE kind WHEN 'ready_to_ship' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END`,
        )
        .bind(orderId)
        .all<MilestoneRow & { shipment_id: string }>()
    ).results;
    const tracking = (
      await db
        .prepare(
          `SELECT id,shipment_id,package_label,carrier_name,tracking_number,
             tracking_url,estimated_arrival_date,version,created_at,updated_at
           FROM shipment_package_tracking WHERE order_id=? ORDER BY created_at,id`,
        )
        .bind(orderId)
        .all<TrackingRow & { shipment_id: string }>()
    ).results;
    const lateReports = isAdmin
      ? (
          await db
            .prepare(
              `SELECT * FROM shipment_late_handoff_reports WHERE order_id=?`,
            )
            .bind(orderId)
            .all<LateReportRow>()
        ).results
      : [];
    const revisedReady = (
      await db
        .prepare(
          `SELECT revision.shipment_id,revision.effective_change_id,
             revision.required_at,revision.verified_at,revision.verified_by
           FROM order_shipping_change_reverification revision
           JOIN order_shipments shipment ON shipment.id=revision.shipment_id
           WHERE shipment.order_id=?`,
        )
        .bind(orderId)
        .all<{
          shipment_id: string;
          effective_change_id: string;
          required_at: string;
          verified_at: string | null;
          verified_by: string | null;
        }>()
    ).results;
    return shipments.map((item) => ({
      shipmentId: item.id,
      displayName: item.display_name,
      status: item.status,
      ...(isAdmin ? { version: item.version } : {}),
      ...(isAdmin
        ? {
            revisedReadyReview: (() => {
              const review = revisedReady.find(
                (row) => row.shipment_id === item.id,
              );
              return review
                ? {
                    effectiveChangeId: review.effective_change_id,
                    requiredAt: review.required_at,
                    verifiedAt: review.verified_at,
                    verifiedBy: review.verified_by,
                  }
                : null;
            })(),
          }
        : {
            releaseReviewPending: revisedReady.some(
              (row) => row.shipment_id === item.id && !row.verified_at,
            ),
          }),
      ...(isAdmin
        ? {
            lateReport: (() => {
              const report = lateReports.find(
                (row) => row.shipment_id === item.id,
              );
              return report
                ? {
                    id: report.id,
                    actualAt: report.actual_at,
                    carrierName: report.carrier_name,
                    source: report.source,
                    reason: report.reason,
                    quantities: JSON.parse(report.quantities_json) as Array<{
                      lineId: string;
                      physicalQuantity: number;
                    }>,
                    recordedAt: report.recorded_at,
                    applied: events.some(
                      (event) =>
                        event.shipment_id === item.id &&
                        event.kind === "shipped",
                    ),
                  }
                : null;
            })(),
          }
        : {}),
      events: events
        .filter((event) => event.shipment_id === item.id)
        .map((event) => ({
          kind: event.kind,
          actualDate: event.actual_date,
          actualAt: event.actual_at,
          recordedAt: event.recorded_at,
          ...(isAdmin
            ? {
                actorId: event.actor_id,
                details: JSON.parse(event.details_json) as Record<
                  string,
                  unknown
                >,
              }
            : {}),
        })),
      tracking: tracking
        .filter((record) => record.shipment_id === item.id)
        .map((record) => {
          const projected = trackingProjection(record);
          return isAdmin
            ? projected
            : {
                id: projected.id,
                packageLabel: projected.packageLabel,
                carrierName: projected.carrierName,
                trackingNumber: projected.trackingNumber,
                trackingUrl: projected.customerTrackingUrl,
                estimatedArrivalDate: projected.estimatedArrivalDate,
              };
        }),
    }));
  }

  async function milestone(
    actor: AdminIdentity,
    input: {
      orderId: string;
      shipmentId: string;
      expectedVersion: number;
      commandId: string;
      kind: ShipmentMilestone;
      previousStatus?: "planned" | "ready_to_ship";
      lateReportId?: string;
      details: Record<string, unknown>;
      actualDate: string | null;
      actualAt: string | null;
    },
  ) {
    assertAdmin(actor);
    commandIdentity(input.commandId);
    const payloadHash = await piSha256(
      new TextEncoder().encode(JSON.stringify(input)),
    );
    const replay = async () => {
      const receipt = await db
        .prepare(
          `SELECT actor_id,order_id,shipment_id,kind,payload_hash,resulting_version
           FROM shipment_milestone_events WHERE command_id=?`,
        )
        .bind(input.commandId)
        .first<{
          actor_id: string;
          order_id: string;
          shipment_id: string;
          kind: ShipmentMilestone;
          payload_hash: string;
          resulting_version: number;
        }>();
      if (!receipt) return null;
      if (
        receipt.actor_id !== actor.id ||
        receipt.order_id !== input.orderId ||
        receipt.shipment_id !== input.shipmentId ||
        receipt.kind !== input.kind ||
        receipt.payload_hash !== payloadHash
      )
        throw new Response("Command identity conflict", { status: 409 });
      return receipt.resulting_version;
    };
    const prior = await replay();
    if (prior !== null) return prior;
    const current = await shipment(input.orderId, input.shipmentId);
    const requiredStatus =
      input.kind === "ready_to_ship"
        ? "planned"
        : input.kind === "shipped"
          ? (input.previousStatus ?? "ready_to_ship")
          : "shipped";
    if (
      current.version !== input.expectedVersion ||
      current.status !== requiredStatus ||
      (input.kind !== "delivered" &&
        !input.lateReportId &&
        (current.plan_status !== "ready" || current.payment_held === 1))
    )
      throw new Response("Shipment changed or release is held; reload", {
        status: 409,
      });
    const recordedAt = now().toISOString();
    const eventId = `shipment-milestone:${input.commandId}`;
    const messageId = `shipment-progress:${input.commandId}`;
    const products = (
      await db
        .prepare(
          `SELECT json_extract(l.snapshot_json,'$.displayName') AS display_name,
             a.physical_quantity
           FROM order_shipment_allocations a JOIN confirmed_order_lines l
             ON l.order_id=a.order_id AND l.line_id=a.line_id
           WHERE a.shipment_id=? ORDER BY l.line_number`,
        )
        .bind(input.shipmentId)
        .all<{ display_name: string | null; physical_quantity: number }>()
    ).results;
    const productText = products
      .map(
        (item) =>
          `${item.display_name ?? "Product"} x ${item.physical_quantity}`,
      )
      .join(", ");
    const label =
      input.kind === "ready_to_ship"
        ? "Ready to Ship"
        : input.kind === "shipped"
          ? "Shipped"
          : "Delivered";
    const body =
      input.kind === "ready_to_ship"
        ? `${current.display_name} (${productText}) is ready to ship. No action is needed from you; tracking information will follow after carrier handoff.`
        : input.kind === "shipped"
          ? `${current.display_name} (${productText}) has shipped. Carrier: ${String(input.details.carrierName)}. Tracking details may follow separately.`
          : `${current.display_name} (${productText}) was delivered on ${input.actualDate}.`;
    const messageHash = await piSha256(new TextEncoder().encode(body));
    const allowed =
      input.kind === "delivered" || input.lateReportId
        ? "1=1"
        : `NOT EXISTS(SELECT 1 FROM order_release_guards g WHERE g.order_id=s.order_id AND g.held=1)
           AND NOT EXISTS(SELECT 1 FROM pi_payment_disputes d JOIN confirmed_orders o ON o.pi_id=d.pi_id
             WHERE o.id=s.order_id AND d.active=1)
           AND NOT EXISTS(SELECT 1 FROM order_quantity_holds h
             JOIN order_shipment_allocations a ON a.order_id=h.order_id AND a.line_id=h.line_id
             WHERE a.shipment_id=s.id AND h.active=1
               AND (h.shipment_id=s.id OR h.shipment_id IS NULL))
           AND NOT EXISTS(SELECT 1 FROM order_shipping_change_reverification revision
             WHERE revision.shipment_id=s.id AND revision.verified_at IS NULL)`;
    const effectiveTerms = `(SELECT revised.value
      FROM order_shipping_change_effective effective,
        json_each(effective.after_json,'$.shipments') revised
      WHERE effective.order_id=s.order_id
        AND json_extract(revised.value,'$.shipmentId')=s.id
      ORDER BY effective.effective_at DESC,effective.id DESC LIMIT 1)`;
    const quotedAllocations = `coalesce(json_extract(${effectiveTerms},'$.allocations'),
      json_extract(s.accepted_terms_json,'$.allocations'))`;
    const allocated = `EXISTS(SELECT 1 FROM order_shipment_allocations a WHERE a.shipment_id=s.id)
         AND NOT EXISTS(SELECT 1 FROM json_each(${quotedAllocations}) quoted
           WHERE coalesce((SELECT sum(a.physical_quantity) FROM order_shipment_allocations a
             WHERE a.shipment_id=s.id AND a.line_id=json_extract(quoted.value,'$.lineId')),0)
             != json_extract(quoted.value,'$.physicalQuantity'))
         AND (${quotedAllocations} IS NULL OR
           (SELECT count(*) FROM json_each(${quotedAllocations}))=
           (SELECT count(*) FROM order_shipment_allocations a WHERE a.shipment_id=s.id))
         AND (${quotedAllocations} IS NOT NULL OR
           (s.group_key='together' AND NOT EXISTS(
             SELECT 1 FROM confirmed_order_lines l WHERE l.order_id=s.order_id
               AND coalesce((SELECT a.physical_quantity FROM order_shipment_allocations a
                 WHERE a.shipment_id=s.id AND a.line_id=l.line_id),0)
               != CASE WHEN l.line_kind='length_based_hose'
                 THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
                 ELSE json_extract(l.snapshot_json,'$.quantity') END)))`;
    try {
      await db.batch([
        db
          .prepare(
            `UPDATE order_shipments AS s SET status=?,version=version+1,updated_at=?
             WHERE s.id=? AND s.order_id=? AND s.version=? AND s.status=?
               AND ${allowed}
               AND (${
                 input.lateReportId
                   ? `EXISTS(SELECT 1 FROM shipment_late_handoff_reports r
                 WHERE r.id=? AND r.order_id=s.order_id
                   AND r.shipment_id=s.id AND r.reported_status=s.status
                   AND r.expected_shipment_version=s.version
                   AND r.actual_at=?)`
                   : "1=1"
               })
               AND (${input.kind === "delivered" ? "1=1" : allocated})
               AND (${input.kind === "delivered" || input.lateReportId ? "1=1" : "EXISTS(SELECT 1 FROM order_fulfillment_plans p WHERE p.order_id=s.order_id AND p.status='ready')"})`,
          )
          .bind(
            input.kind,
            recordedAt,
            input.shipmentId,
            input.orderId,
            input.expectedVersion,
            requiredStatus,
            ...(input.lateReportId ? [input.lateReportId, input.actualAt] : []),
          ),
        db
          .prepare(
            `INSERT INTO shipment_milestone_events
             (id,order_id,shipment_id,kind,actual_date,actual_at,recorded_at,
               actor_id,previous_version,resulting_version,details_json,command_id,payload_hash)
             SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1`,
          )
          .bind(
            eventId,
            input.orderId,
            input.shipmentId,
            input.kind,
            input.actualDate,
            input.actualAt,
            recordedAt,
            actor.id,
            input.expectedVersion,
            input.expectedVersion + 1,
            JSON.stringify(input.details),
            input.commandId,
            payloadHash,
          ),
        ...(input.kind === "shipped"
          ? [
              db
                .prepare(
                  `INSERT INTO shipment_dispatch_quantities
                   (order_id,shipment_id,line_id,physical_quantity,event_id)
                   SELECT a.order_id,a.shipment_id,a.line_id,a.physical_quantity,?
                   FROM order_shipment_allocations a WHERE a.shipment_id=?
                     AND EXISTS(SELECT 1 FROM shipment_milestone_events e WHERE e.id=?)`,
                )
                .bind(eventId, input.shipmentId, eventId),
            ]
          : []),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,?,'order_shipment',?,?,?,?
             WHERE EXISTS(SELECT 1 FROM shipment_milestone_events WHERE id=?)`,
          )
          .bind(
            eventId,
            `shipment.${input.kind}`,
            input.shipmentId,
            actor.id,
            JSON.stringify({
              requestId: input.commandId,
              ipAddress: options.auditIp ?? null,
              orderId: input.orderId,
              previousVersion: input.expectedVersion,
              resultingVersion: input.expectedVersion + 1,
              actualDate: input.actualDate,
              actualAt: input.actualAt,
              details: input.details,
            }),
            recordedAt,
            eventId,
          ),
        db
          .prepare(
            `INSERT INTO quote_conversations(request_id,created_at)
             SELECT ?,? WHERE EXISTS(SELECT 1 FROM shipment_milestone_events WHERE id=?)
             ON CONFLICT(request_id) DO NOTHING`,
          )
          .bind(current.request_id, recordedAt, eventId),
        db
          .prepare(
            `INSERT INTO quote_conversation_messages
             (id,request_id,author_role,author_id,body,created_at,command_id,
               payload_hash,source,delivery_state)
             SELECT ?,?,'admin',?,?,?,?,?,'website','available'
             WHERE EXISTS(SELECT 1 FROM shipment_milestone_events WHERE id=?)
             ON CONFLICT(command_id) DO NOTHING`,
          )
          .bind(
            messageId,
            current.request_id,
            actor.id,
            body,
            recordedAt,
            messageId,
            messageHash,
            eventId,
          ),
        quoteNotificationOutboxStatement(db, {
          messageId,
          requestId: current.request_id,
          createdAt: recordedAt,
        }),
      ]);
    } catch (error) {
      const receipt = await replay();
      if (receipt !== null) return receipt;
      throw error;
    }
    const receipt = await replay();
    if (receipt === null)
      throw new Response(`${label} was not recorded; reload the Shipment`, {
        status: 409,
      });
    return receipt;
  }

  return {
    async adminRead(actor: AdminIdentity, orderId: string) {
      assertAdmin(actor);
      const exists = await db
        .prepare("SELECT id FROM confirmed_orders WHERE id=?")
        .bind(orderId)
        .first();
      if (!exists) throw new Response("Order not found", { status: 404 });
      return read(orderId, true);
    },
    async customerRead(profileId: string, orderId: string) {
      await owned(profileId, orderId);
      return read(orderId, false);
    },
    async markReady(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        expectedVersion: number;
        commandId: string;
        verification: ReadinessVerification;
      },
    ) {
      const verification = verifiedReadiness(input.verification);
      return milestone(actor, {
        ...input,
        kind: "ready_to_ship",
        details: { verification },
        actualDate: null,
        actualAt: null,
      });
    },
    async markShipped(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        expectedVersion: number;
        commandId: string;
        handoffAt: string;
        carrierName: string;
        source: string;
      },
    ) {
      const handoff = actualHandoffInstant(input.handoffAt, now());
      const ready = await db
        .prepare(
          `SELECT recorded_at FROM shipment_milestone_events
           WHERE shipment_id=? AND order_id=? AND kind='ready_to_ship'`,
        )
        .bind(input.shipmentId, input.orderId)
        .first<{ recorded_at: string }>();
      if (
        !ready ||
        Temporal.Instant.compare(
          Temporal.Instant.from(handoff.at),
          Temporal.Instant.from(ready.recorded_at),
        ) < 0
      )
        throw new Response(
          "Carrier handoff cannot precede verified readiness",
          {
            status: 400,
          },
        );
      const details = {
        carrierName: reviewedText(input.carrierName, "Carrier"),
        source: reviewedText(input.source, "Carrier handoff source"),
      };
      return milestone(actor, {
        orderId: input.orderId,
        shipmentId: input.shipmentId,
        expectedVersion: input.expectedVersion,
        commandId: input.commandId,
        kind: "shipped",
        details,
        actualDate: handoff.date,
        actualAt: handoff.at,
      });
    },
    async markDelivered(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        expectedVersion: number;
        commandId: string;
        actualDate: string;
        source: string;
      },
    ) {
      const deliveredDate = actualChinaDate(input.actualDate, now());
      const shipped = await db
        .prepare(
          `SELECT actual_date FROM shipment_milestone_events
           WHERE shipment_id=? AND order_id=? AND kind='shipped'`,
        )
        .bind(input.shipmentId, input.orderId)
        .first<{ actual_date: string }>();
      if (!shipped || deliveredDate < shipped.actual_date)
        throw new Response("Delivery cannot precede carrier handoff", {
          status: 400,
        });
      return milestone(actor, {
        orderId: input.orderId,
        shipmentId: input.shipmentId,
        expectedVersion: input.expectedVersion,
        commandId: input.commandId,
        kind: "delivered",
        details: { source: reviewedText(input.source, "Delivery source") },
        actualDate: deliveredDate,
        actualAt: null,
      });
    },
    async reportLateHandoff(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        expectedVersion: number;
        commandId: string;
        handoffAt: string;
        carrierName: string;
        source: string;
        reason: string;
      },
    ) {
      assertAdmin(actor);
      commandIdentity(input.commandId);
      const handoff = actualHandoffInstant(input.handoffAt, now());
      const carrierName = reviewedText(input.carrierName, "Carrier");
      const source = reviewedText(input.source, "Carrier handoff source");
      const reason = reviewedText(input.reason, "Late handoff review reason");
      const payloadHash = await piSha256(
        new TextEncoder().encode(
          JSON.stringify({ ...input, handoff, carrierName, source, reason }),
        ),
      );
      const replay = async () => {
        const receipt = await db
          .prepare(
            `SELECT id,actor_id,order_id,shipment_id,payload_hash
             FROM shipment_late_handoff_reports WHERE command_id=?`,
          )
          .bind(input.commandId)
          .first<
            Pick<
              LateReportRow,
              "id" | "actor_id" | "order_id" | "shipment_id" | "payload_hash"
            >
          >();
        if (!receipt) return null;
        if (
          receipt.actor_id !== actor.id ||
          receipt.order_id !== input.orderId ||
          receipt.shipment_id !== input.shipmentId ||
          receipt.payload_hash !== payloadHash
        )
          throw new Response("Command identity conflict", { status: 409 });
        return receipt.id;
      };
      const prior = await replay();
      if (prior) return prior;
      const current = await shipment(input.orderId, input.shipmentId);
      if (
        current.version !== input.expectedVersion ||
        !["planned", "ready_to_ship"].includes(current.status)
      )
        throw new Response("Shipment changed; review the handoff exception", {
          status: 409,
        });
      const allocations = (
        await db
          .prepare(
            `SELECT line_id,physical_quantity FROM order_shipment_allocations
             WHERE order_id=? AND shipment_id=? ORDER BY line_id`,
          )
          .bind(input.orderId, input.shipmentId)
          .all<{ line_id: string; physical_quantity: number }>()
      ).results.map((row) => ({
        lineId: row.line_id,
        physicalQuantity: row.physical_quantity,
      }));
      const accepted = await db
        .prepare(
          `SELECT accepted_terms_json,group_key,
             (SELECT revised.value FROM order_shipping_change_effective effective,
               json_each(effective.after_json,'$.shipments') revised
               WHERE effective.order_id=shipment.order_id
                 AND json_extract(revised.value,'$.shipmentId')=shipment.id
               ORDER BY effective.effective_at DESC,effective.id DESC LIMIT 1)
               AS effective_terms_json
           FROM order_shipments shipment WHERE shipment.id=?`,
        )
        .bind(input.shipmentId)
        .first<{
          accepted_terms_json: string;
          group_key: string;
          effective_terms_json: string | null;
        }>();
      const quoted = JSON.parse(
        accepted!.effective_terms_json ?? accepted!.accepted_terms_json,
      ) as {
        allocations?: Array<{ lineId: string; physicalQuantity: number }>;
      };
      let expected = quoted.allocations;
      if (!expected && accepted!.group_key === "together")
        expected = (
          await db
            .prepare(
              `SELECT line_id AS lineId,CASE WHEN line_kind='length_based_hose'
                 THEN json_extract(snapshot_json,'$.lengthOrder.pieceCount')
                 ELSE json_extract(snapshot_json,'$.quantity') END AS physicalQuantity
               FROM confirmed_order_lines WHERE order_id=?`,
            )
            .bind(input.orderId)
            .all<{ lineId: string; physicalQuantity: number }>()
        ).results;
      if (
        !allocations.length ||
        !expected ||
        allocations.length !== expected.length ||
        expected.some(
          (line) =>
            allocations.find((item) => item.lineId === line.lineId)
              ?.physicalQuantity !== line.physicalQuantity,
        )
      )
        throw new Response(
          "Resolve exact shipment quantities before reconciling handoff",
          {
            status: 409,
          },
        );
      const id = `late-handoff:${input.commandId}`;
      const recordedAt = now().toISOString();
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO shipment_late_handoff_reports
               (id,order_id,shipment_id,expected_shipment_version,reported_status,
                 actual_at,actual_date,carrier_name,source,reason,quantities_json,
                 actor_id,recorded_at,command_id,payload_hash)
               SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM order_shipments s
               WHERE s.id=? AND s.order_id=? AND s.version=? AND s.status IN ('planned','ready_to_ship')`,
            )
            .bind(
              id,
              input.orderId,
              input.shipmentId,
              input.expectedVersion,
              current.status,
              handoff.at,
              handoff.date,
              carrierName,
              source,
              reason,
              JSON.stringify(allocations),
              actor.id,
              recordedAt,
              input.commandId,
              payloadHash,
              input.shipmentId,
              input.orderId,
              input.expectedVersion,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events
               (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
               SELECT ?,'shipment.late_handoff_reported','order_shipment',?,?,?,?
               WHERE EXISTS(SELECT 1 FROM shipment_late_handoff_reports WHERE id=?)`,
            )
            .bind(
              id,
              input.shipmentId,
              actor.id,
              JSON.stringify({
                requestId: input.commandId,
                ipAddress: options.auditIp ?? null,
                handoff,
                carrierName,
                source,
                reason,
                allocations,
              }),
              recordedAt,
              id,
            ),
        ]);
      } catch (error) {
        const receipt = await replay();
        if (receipt) return receipt;
        throw error;
      }
      const receipt = await replay();
      if (!receipt)
        throw new Response("Shipment changed; review the handoff exception", {
          status: 409,
        });
      return receipt;
    },
    async applyLateHandoff(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        reportId: string;
        expectedVersion: number;
        commandId: string;
      },
    ) {
      assertAdmin(actor);
      const report = await db
        .prepare(
          `SELECT * FROM shipment_late_handoff_reports
           WHERE id=? AND order_id=? AND shipment_id=?`,
        )
        .bind(input.reportId, input.orderId, input.shipmentId)
        .first<LateReportRow>();
      if (!report)
        throw new Response("Late handoff report not found", { status: 404 });
      const allocated = (
        await db
          .prepare(
            `SELECT line_id AS lineId,physical_quantity AS physicalQuantity
             FROM order_shipment_allocations WHERE order_id=? AND shipment_id=? ORDER BY line_id`,
          )
          .bind(input.orderId, input.shipmentId)
          .all<{ lineId: string; physicalQuantity: number }>()
      ).results;
      if (JSON.stringify(allocated) !== report.quantities_json)
        throw new Response(
          "Shipment quantities changed after reported handoff",
          {
            status: 409,
          },
        );
      return milestone(actor, {
        orderId: input.orderId,
        shipmentId: input.shipmentId,
        expectedVersion: input.expectedVersion,
        commandId: input.commandId,
        kind: "shipped",
        previousStatus: report.reported_status,
        lateReportId: report.id,
        details: {
          carrierName: report.carrier_name,
          source: report.source,
          reason: report.reason,
          reconciliationReportId: report.id,
          quantities: allocated,
        },
        actualDate: report.actual_date,
        actualAt: report.actual_at,
      });
    },
    async saveTracking(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        trackingId?: string;
        expectedVersion: number;
        commandId: string;
        packageLabel: string;
        carrierName: string;
        trackingNumber?: string;
        trackingUrl?: string;
        estimatedArrivalDate?: string;
        reason: string;
      },
    ) {
      assertAdmin(actor);
      commandIdentity(input.commandId);
      const current = await shipment(input.orderId, input.shipmentId);
      const trackingId = input.trackingId ?? `tracking:${input.commandId}`;
      const tracking = {
        packageLabel: reviewedText(input.packageLabel, "Package label"),
        carrierName: reviewedText(input.carrierName, "Carrier"),
        trackingNumber: input.trackingNumber?.trim() || null,
        trackingUrl: trackingDestination(input.trackingUrl).storedUrl,
        estimatedArrivalDate: input.estimatedArrivalDate?.trim() || null,
      };
      if (tracking.estimatedArrivalDate) {
        try {
          if (
            Temporal.PlainDate.from(
              tracking.estimatedArrivalDate,
            ).toString() !== tracking.estimatedArrivalDate
          )
            throw new Error("Invalid date");
        } catch {
          throw new Response("Invalid estimated arrival date", { status: 400 });
        }
      }
      if (
        (tracking.trackingNumber && tracking.trackingNumber.length > 200) ||
        (tracking.estimatedArrivalDate &&
          !/^\d{4}-\d{2}-\d{2}$/.test(tracking.estimatedArrivalDate))
      )
        throw new Response("Invalid tracking details", { status: 400 });
      const reason = reviewedText(
        input.reason,
        "Tracking source or correction reason",
      );
      const replay = async () => {
        const receipt = await db
          .prepare(
            `SELECT actor_id,order_id,shipment_id,tracking_id,previous_version,
               resulting_version,after_json,reason
             FROM shipment_package_tracking_events WHERE command_id=?`,
          )
          .bind(input.commandId)
          .first<{
            actor_id: string;
            order_id: string;
            shipment_id: string;
            tracking_id: string;
            previous_version: number;
            resulting_version: number;
            after_json: string;
            reason: string;
          }>();
        if (!receipt) return null;
        if (
          receipt.actor_id !== actor.id ||
          receipt.order_id !== input.orderId ||
          receipt.shipment_id !== input.shipmentId ||
          receipt.tracking_id !== trackingId ||
          receipt.previous_version !== input.expectedVersion ||
          receipt.after_json !== JSON.stringify(tracking) ||
          receipt.reason !== reason
        )
          throw new Response("Command identity conflict", { status: 409 });
        return receipt.resulting_version;
      };
      const prior = await replay();
      if (prior !== null) return prior;
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 0
      )
        throw new Response("Invalid tracking version", { status: 400 });
      if (current.status === "planned" && !input.trackingId)
        throw new Response("Carrier tracking starts after readiness", {
          status: 409,
        });
      const existing = await db
        .prepare(
          `SELECT * FROM shipment_package_tracking
           WHERE order_id=? AND shipment_id=? AND id=?`,
        )
        .bind(input.orderId, input.shipmentId, trackingId)
        .first<TrackingRow>();
      if (
        (existing?.version ?? 0) !== input.expectedVersion ||
        (!existing && input.trackingId)
      )
        throw new Response("Tracking changed; reload", { status: 409 });
      const recordedAt = now().toISOString();
      const write = existing
        ? db
            .prepare(
              `UPDATE shipment_package_tracking SET package_label=?,carrier_name=?,
                 tracking_number=?,tracking_url=?,estimated_arrival_date=?,
                 version=version+1,updated_at=?
               WHERE id=? AND order_id=? AND shipment_id=? AND version=?`,
            )
            .bind(
              tracking.packageLabel,
              tracking.carrierName,
              tracking.trackingNumber,
              tracking.trackingUrl,
              tracking.estimatedArrivalDate,
              recordedAt,
              trackingId,
              input.orderId,
              input.shipmentId,
              input.expectedVersion,
            )
        : db
            .prepare(
              `INSERT INTO shipment_package_tracking
               (id,order_id,shipment_id,package_label,carrier_name,
                 tracking_number,tracking_url,estimated_arrival_date,version,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
            )
            .bind(
              trackingId,
              input.orderId,
              input.shipmentId,
              tracking.packageLabel,
              tracking.carrierName,
              tracking.trackingNumber,
              tracking.trackingUrl,
              tracking.estimatedArrivalDate,
              recordedAt,
              recordedAt,
            );
      try {
        await db.batch([
          write,
          db
            .prepare(
              `INSERT INTO shipment_package_tracking_events
               (id,tracking_id,order_id,shipment_id,actor_id,before_json,
                 after_json,previous_version,resulting_version,reason,recorded_at,command_id)
               SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1`,
            )
            .bind(
              `tracking-event:${input.commandId}`,
              trackingId,
              input.orderId,
              input.shipmentId,
              actor.id,
              existing ? JSON.stringify(trackingProjection(existing)) : null,
              JSON.stringify(tracking),
              input.expectedVersion,
              input.expectedVersion + 1,
              reason,
              recordedAt,
              input.commandId,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events
               (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
               SELECT ?,'shipment.tracking_saved','shipment',?,?,?,?
               WHERE EXISTS(SELECT 1 FROM shipment_package_tracking_events WHERE command_id=?)`,
            )
            .bind(
              `tracking-audit:${input.commandId}`,
              input.shipmentId,
              actor.id,
              JSON.stringify({
                trackingId,
                before: existing ? trackingProjection(existing) : null,
                after: tracking,
                reason,
                previousVersion: input.expectedVersion,
              }),
              recordedAt,
              input.commandId,
            ),
        ]);
      } catch (error) {
        const receipt = await replay();
        if (receipt !== null) return receipt;
        throw error;
      }
      const receipt = await replay();
      if (receipt === null)
        throw new Response("Tracking changed; reload", { status: 409 });
      return receipt;
    },
  };
}
