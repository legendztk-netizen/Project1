import type { AdminIdentity } from "#workers/admin-access";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";

type ChangeKind = "delivery_address" | "shipping_plan";

interface ShipmentRow {
  id: string;
  version: number;
  status: string;
  line_id: string;
  physical_quantity: number;
}

interface RequestRow {
  id: string;
  order_id: string;
  profile_id: string;
  kind: ChangeKind;
  status: string;
  version: number;
  requested_json: string;
  current_proposal_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposedShipment {
  shipmentId: string;
  destination: Record<string, string>;
  carrierName: string;
  serviceName: string;
  transportMethod: string;
  incoterm: "DDP" | "DAP";
  namedPlace: string;
  destinationTaxTreatment: string;
  readyDate: string | null;
  allocations: Array<{ lineId: string; physicalQuantity: number }>;
}

const hash = (value: string) => piSha256(new TextEncoder().encode(value));
const conflict = () =>
  new Response("Shipping change state changed; reload", { status: 409 });

function text(value: unknown, label: string, maximum = 300) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Response(`${label} required`, { status: 400 });
  return value.trim();
}

function requestContent(kind: ChangeKind, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Response("Change details required", { status: 400 });
  const record = input as Record<string, unknown>;
  const note = text(record.note, "Change reason", 2000);
  if (kind === "shipping_plan") return { note };
  const destination = record.destination;
  if (
    !destination ||
    typeof destination !== "object" ||
    Array.isArray(destination)
  )
    throw new Response("Delivery address required", { status: 400 });
  const address = destination as Record<string, unknown>;
  const countryCode = text(
    address.countryCode,
    "Country code",
    2,
  ).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode))
    throw new Response("Invalid country code", { status: 400 });
  return {
    note,
    destination: {
      recipientName: text(address.recipientName, "Recipient"),
      addressLine1: text(address.addressLine1, "Address"),
      addressLine2:
        typeof address.addressLine2 === "string"
          ? address.addressLine2.trim().slice(0, 300)
          : "",
      city: text(address.city, "City"),
      stateProvince: text(address.stateProvince, "State/Province"),
      postalCode: text(address.postalCode, "Postal code", 50),
      countryCode,
      recipientPhone:
        typeof address.recipientPhone === "string"
          ? address.recipientPhone.trim().slice(0, 100)
          : "",
      recipientEmail:
        typeof address.recipientEmail === "string"
          ? address.recipientEmail.trim().slice(0, 200)
          : "",
    },
  };
}

function reviewedShipment(value: unknown): ProposedShipment {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Response("Shipment terms required", { status: 400 });
  const item = value as Record<string, unknown>;
  if (
    !item.destination ||
    typeof item.destination !== "object" ||
    Array.isArray(item.destination)
  )
    throw new Response("Delivery address required", { status: 400 });
  const destination = (
    requestContent("delivery_address", {
      note: "Reviewed shipping terms",
      destination: item.destination,
    }) as { destination: Record<string, string> }
  ).destination;
  const incoterm = text(item.incoterm, "Incoterm", 3);
  if (incoterm !== "DDP" && incoterm !== "DAP")
    throw new Response("DDP or DAP required", { status: 400 });
  const readyDate =
    item.readyDate === null || item.readyDate === ""
      ? null
      : text(item.readyDate, "Ready date", 10);
  if (readyDate && !/^\d{4}-\d{2}-\d{2}$/.test(readyDate))
    throw new Response("Invalid ready date", { status: 400 });
  if (
    !Array.isArray(item.allocations) ||
    !item.allocations.length ||
    item.allocations.length > 100
  )
    throw new Response("Shipment quantities required", { status: 400 });
  const allocations = item.allocations.map((allocation) => {
    if (!allocation || typeof allocation !== "object")
      throw new Response("Invalid shipment quantity", { status: 400 });
    const row = allocation as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.physicalQuantity) ||
      (row.physicalQuantity as number) < 1
    )
      throw new Response("Invalid shipment quantity", { status: 400 });
    return {
      lineId: text(row.lineId, "Order line ID", 200),
      physicalQuantity: row.physicalQuantity as number,
    };
  });
  if (
    new Set(allocations.map((item) => item.lineId)).size !== allocations.length
  )
    throw new Response("Duplicate order line", { status: 400 });
  const optional = (value: unknown, label: string) =>
    typeof value === "string"
      ? value.trim().slice(0, 300)
      : value === null || value === undefined
        ? ""
        : text(value, label);
  return {
    shipmentId: text(item.shipmentId, "Shipment ID", 200),
    destination,
    carrierName: optional(item.carrierName, "Carrier"),
    serviceName: optional(item.serviceName, "Service"),
    transportMethod: text(item.transportMethod, "Transport method"),
    incoterm,
    namedPlace: text(item.namedPlace, "Named place"),
    destinationTaxTreatment: text(
      item.destinationTaxTreatment,
      "Tax treatment",
    ),
    readyDate,
    allocations,
  };
}

export function createOrderShippingChangeService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string | null } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();

  async function assertOwned(profileId: string, orderId: string) {
    if (!profileId) throw new Response("Forbidden", { status: 403 });
    const row = await db
      .prepare(
        `SELECT o.id,o.request_id FROM confirmed_orders o
         JOIN customer_quote_requests request ON request.id=o.request_id
         ${ownedQuoteRequestWhere} AND o.id=?`,
      )
      .bind(profileId, profileId, profileId, orderId)
      .first<{ id: string; request_id: string }>();
    if (!row) throw new Response("Order not found", { status: 404 });
    return row;
  }

  async function assertAdmin(actor: AdminIdentity, orderId: string) {
    if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
      throw new Response("Forbidden", { status: 403 });
    const row = await db
      .prepare("SELECT request_id FROM confirmed_orders WHERE id=?")
      .bind(orderId)
      .first<{ request_id: string }>();
    if (!row) throw new Response("Order not found", { status: 404 });
    return row;
  }

  async function requests(orderId: string) {
    const records = (
      await db
        .prepare(
          `SELECT * FROM order_shipping_change_requests WHERE order_id=?
           ORDER BY created_at DESC,id DESC`,
        )
        .bind(orderId)
        .all<RequestRow>()
    ).results;
    const proposals = (
      await db
        .prepare(
          `SELECT p.id,p.request_id,p.version,p.before_json,p.after_json,
             p.adjustment_cents,p.reason,p.expires_at,p.proposal_hash,p.published_at,
             a.accepted_at,
             (SELECT due_cents FROM order_shipping_change_refund_reservations r
               JOIN order_shipping_change_effective e ON e.id=r.effective_change_id
               WHERE e.proposal_id=p.id) AS refund_due_cents,
             (SELECT coalesce(sum(i.amount_cents),0)
               FROM order_shipping_change_refund_initiations i
               JOIN order_shipping_change_refund_reservations r ON r.id=i.reservation_id
               JOIN order_shipping_change_effective e ON e.id=r.effective_change_id
               WHERE e.proposal_id=p.id) AS refund_initiated_cents
           FROM order_shipping_change_proposals p
           JOIN order_shipping_change_requests request ON request.id=p.request_id
           LEFT JOIN order_shipping_change_acceptances a ON a.proposal_id=p.id
           WHERE request.order_id=? ORDER BY p.version`,
        )
        .bind(orderId)
        .all<{
          id: string;
          request_id: string;
          version: number;
          before_json: string;
          after_json: string;
          adjustment_cents: number;
          reason: string;
          expires_at: string;
          proposal_hash: string;
          published_at: string;
          accepted_at: string | null;
          refund_due_cents: number | null;
          refund_initiated_cents: number;
        }>()
    ).results;
    const affected = (
      await db
        .prepare(
          `SELECT affected.request_id,affected.shipment_id,affected.shipment_version,
             affected.quantities_json FROM order_shipping_change_shipments affected
           JOIN order_shipping_change_requests request ON request.id=affected.request_id
           WHERE request.order_id=?`,
        )
        .bind(orderId)
        .all<{
          request_id: string;
          shipment_id: string;
          shipment_version: number;
          quantities_json: string;
        }>()
    ).results;
    return records.map((record) => ({
      id: record.id,
      kind: record.kind,
      status: record.status,
      version: record.version,
      requested: JSON.parse(record.requested_json) as ReturnType<
        typeof requestContent
      >,
      currentProposalId: record.current_proposal_id,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      shipments: affected
        .filter((item) => item.request_id === record.id)
        .map((item) => ({
          shipmentId: item.shipment_id,
          versionAtRequest: item.shipment_version,
          quantities: JSON.parse(item.quantities_json) as Array<{
            lineId: string;
            physicalQuantity: number;
          }>,
        })),
      proposals: proposals
        .filter((proposal) => proposal.request_id === record.id)
        .map((proposal) => ({
          id: proposal.id,
          version: proposal.version,
          before: JSON.parse(proposal.before_json) as {
            shipments: ProposedShipment[];
          },
          after: JSON.parse(proposal.after_json) as {
            shipments: ProposedShipment[];
          },
          adjustmentCents: proposal.adjustment_cents,
          reason: proposal.reason,
          expiresAt: proposal.expires_at,
          proposalHash: proposal.proposal_hash,
          publishedAt: proposal.published_at,
          acceptedAt: proposal.accepted_at,
          refundDueCents: proposal.refund_due_cents,
          refundInitiatedCents: proposal.refund_initiated_cents,
        })),
    }));
  }

  async function currentRequest(orderId: string, requestId: string) {
    const row = await db
      .prepare(
        `SELECT * FROM order_shipping_change_requests WHERE id=? AND order_id=?`,
      )
      .bind(requestId, orderId)
      .first<RequestRow>();
    if (!row) throw new Response("Change request not found", { status: 404 });
    return row;
  }

  async function changeMessage(
    requestId: string,
    actorId: string,
    orderRequestId: string,
    body: string,
    timestamp: string,
    messageId: string,
    eventCommandId: string,
  ) {
    return [
      db
        .prepare(
          `INSERT INTO quote_conversations(request_id,created_at)
         SELECT ?,? WHERE EXISTS(SELECT 1 FROM order_shipping_change_events
           WHERE request_id=? AND command_id=?)
         ON CONFLICT(request_id) DO NOTHING`,
        )
        .bind(orderRequestId, timestamp, requestId, eventCommandId),
      db
        .prepare(
          `INSERT INTO quote_conversation_messages
         (id,request_id,author_role,author_id,body,created_at,command_id,
          payload_hash,source,delivery_state)
         SELECT ?,?,'admin',?,?,?, ?,?,'website','available'
         WHERE EXISTS(SELECT 1 FROM order_shipping_change_events
           WHERE request_id=? AND command_id=?)
         ON CONFLICT(command_id) DO NOTHING`,
        )
        .bind(
          messageId,
          orderRequestId,
          actorId,
          body,
          timestamp,
          messageId,
          await hash(body),
          requestId,
          eventCommandId,
        ),
      quoteNotificationOutboxStatement(db, {
        messageId,
        requestId: orderRequestId,
        createdAt: timestamp,
      }),
    ];
  }

  async function beforeShipments(orderId: string, shipmentIds: string[]) {
    const timestamp = now();
    await db
      .prepare(
        `INSERT INTO order_shipment_ready_schedules
       (shipment_id,order_id,accepted_basis_json,created_at,updated_at)
       SELECT id,order_id,json_extract(accepted_terms_json,'$.readySchedule'),?,?
       FROM order_shipments WHERE order_id=?
       ON CONFLICT(shipment_id) DO NOTHING`,
      )
      .bind(timestamp, timestamp, orderId)
      .run();
    const order = await db
      .prepare(
        `SELECT snapshot_json,snapshot_hash FROM confirmed_orders WHERE id=?`,
      )
      .bind(orderId)
      .first<{ snapshot_json: string; snapshot_hash: string }>();
    if (!order || (await hash(order.snapshot_json)) !== order.snapshot_hash)
      throw new Response("Order snapshot integrity failure", { status: 409 });
    const snapshot = JSON.parse(order.snapshot_json) as {
      destination: Record<string, string>;
      terms: {
        transportMethod: string;
        incoterm: "DDP" | "DAP";
        namedPlace: string;
        salesTaxTreatment?: string;
      };
    };
    const rows = (
      await db
        .prepare(
          `SELECT shipment.id,shipment.version AS shipment_version,
        shipment.accepted_terms_json,ready.version AS schedule_version,
        ready.current_estimate_date FROM order_shipments shipment
       LEFT JOIN order_shipment_ready_schedules ready ON ready.shipment_id=shipment.id
       WHERE shipment.order_id=?`,
        )
        .bind(orderId)
        .all<{
          id: string;
          shipment_version: number;
          accepted_terms_json: string;
          schedule_version: number | null;
          current_estimate_date: string | null;
        }>()
    ).results;
    const allocations = (
      await db
        .prepare(
          `SELECT shipment_id,line_id,physical_quantity
       FROM order_shipment_allocations WHERE order_id=?
       ORDER BY shipment_id,line_id`,
        )
        .bind(orderId)
        .all<{
          shipment_id: string;
          line_id: string;
          physical_quantity: number;
        }>()
    ).results;
    const prior = (
      await db
        .prepare(
          `SELECT after_json FROM order_shipping_change_effective
       WHERE order_id=? ORDER BY effective_at,id`,
        )
        .bind(orderId)
        .all<{ after_json: string }>()
    ).results;
    const overlays = new Map<string, ProposedShipment>();
    for (const effect of prior) {
      const after = JSON.parse(effect.after_json) as {
        shipments: ProposedShipment[];
      };
      for (const shipment of after.shipments)
        overlays.set(shipment.shipmentId, shipment);
    }
    return shipmentIds.map((shipmentId) => {
      const row = rows.find((candidate) => candidate.id === shipmentId);
      if (!row) throw conflict();
      const quoted = JSON.parse(row.accepted_terms_json) as Record<
        string,
        unknown
      >;
      const overlay = overlays.get(shipmentId);
      return {
        shipmentId,
        shipmentVersion: row.shipment_version,
        scheduleVersion: row.schedule_version,
        destination: overlay?.destination ?? snapshot.destination,
        carrierName: overlay?.carrierName ?? "",
        serviceName: overlay?.serviceName ?? "",
        transportMethod:
          overlay?.transportMethod ??
          ((quoted.transportMethod as string) ||
            snapshot.terms.transportMethod),
        incoterm:
          overlay?.incoterm ??
          ((quoted.incoterm as "DDP" | "DAP") || snapshot.terms.incoterm),
        namedPlace:
          overlay?.namedPlace ??
          ((quoted.namedPlace as string) || snapshot.terms.namedPlace),
        destinationTaxTreatment:
          overlay?.destinationTaxTreatment ??
          snapshot.terms.salesTaxTreatment ??
          "As accepted in PI",
        readyDate: row.current_estimate_date,
        allocations: allocations
          .filter((allocation) => allocation.shipment_id === shipmentId)
          .map((allocation) => ({
            lineId: allocation.line_id,
            physicalQuantity: allocation.physical_quantity,
          })),
      } satisfies ProposedShipment & {
        shipmentVersion: number;
        scheduleVersion: number | null;
      };
    });
  }

  async function closeRequest(
    input: {
      orderId: string;
      requestId: string;
      expectedVersion: number;
      commandId: string;
      reason: string;
    },
    actorId: string,
    status: "withdrawn" | "declined",
    orderRequestId: string,
  ) {
    const commandId = text(input.commandId, "Command ID", 100);
    const reason = text(input.reason, "Decision reason", 2000);
    const eventId = `shipping-change-${status}:${commandId}`;
    const replay = await db
      .prepare(`SELECT payload_json FROM admin_audit_events WHERE id=?`)
      .bind(eventId)
      .first<{ payload_json: string }>();
    if (replay) {
      const payload = JSON.parse(replay.payload_json) as {
        requestId: string;
        actorId: string;
        reason: string;
      };
      if (
        payload.requestId !== input.requestId ||
        payload.actorId !== actorId ||
        payload.reason !== reason
      )
        throw conflict();
      return;
    }
    const request = await currentRequest(input.orderId, input.requestId);
    if (
      request.version !== input.expectedVersion ||
      !["pending_review", "proposed", "accepted"].includes(request.status)
    )
      throw conflict();
    const timestamp = now();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE order_shipping_change_requests
         SET status=?,version=version+1,updated_at=?
         WHERE id=? AND order_id=? AND version=?
           AND status IN ('pending_review','proposed','accepted')`,
        )
        .bind(
          status,
          timestamp,
          input.requestId,
          input.orderId,
          input.expectedVersion,
        ),
      db
        .prepare(
          `INSERT INTO order_shipping_change_events
         (id,request_id,kind,details_json,actor_id,occurred_at,command_id)
         SELECT ?,?,?,?,?,?,? WHERE changes()=1`,
        )
        .bind(
          eventId,
          input.requestId,
          status,
          JSON.stringify({ reason }),
          actorId,
          timestamp,
          commandId,
        ),
      db
        .prepare(
          `UPDATE order_quantity_holds SET active=0,resolved_at=?
         WHERE active=1 AND id IN (SELECT hold_id FROM order_shipping_change_hold_links
           WHERE request_id=?)
           AND EXISTS(SELECT 1 FROM order_shipping_change_events WHERE id=?)`,
        )
        .bind(timestamp, input.requestId, eventId),
      db
        .prepare(
          `DELETE FROM order_shipping_change_active_shipments WHERE request_id=?
         AND EXISTS(SELECT 1 FROM order_shipping_change_events WHERE id=?)`,
        )
        .bind(input.requestId, eventId),
      db
        .prepare(
          `INSERT INTO admin_audit_events
         (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
         SELECT ?,?,'confirmed_order',?,?,?,?
         WHERE EXISTS(SELECT 1 FROM order_shipping_change_events WHERE id=?)`,
        )
        .bind(
          eventId,
          `order.shipping_change_${status}`,
          input.orderId,
          actorId,
          JSON.stringify({
            requestId: input.requestId,
            actorId,
            reason,
            commandId,
            ipAddress: options.auditIp ?? null,
          }),
          timestamp,
          eventId,
        ),
    ];
    if (status === "declined")
      statements.push(
        ...(await changeMessage(
          input.requestId,
          actorId,
          orderRequestId,
          `The requested shipping change for Order ${input.orderId} was declined. Reason: ${reason}. The original shipping instructions remain in effect.`,
          timestamp,
          `shipping-change-declined:${commandId}`,
          commandId,
        )),
      );
    try {
      const results = await db.batch(statements);
      if (results[0].meta.changes !== 1) throw conflict();
    } catch (error) {
      if (error instanceof Response) throw error;
      throw conflict();
    }
  }

  return {
    async customerRead(profileId: string, orderId: string) {
      await assertOwned(profileId, orderId);
      return requests(orderId);
    },
    async adminRead(actor: AdminIdentity, orderId: string) {
      await assertAdmin(actor, orderId);
      return requests(orderId);
    },
    async customerSubmit(
      profileId: string,
      input: {
        orderId: string;
        kind: ChangeKind;
        requested: unknown;
        shipments: Array<{ shipmentId: string; expectedVersion: number }>;
        commandId: string;
      },
    ) {
      const orderId = text(input.orderId, "Order ID", 200);
      const commandId = text(input.commandId, "Command ID", 100);
      if (!/^[0-9a-f-]{36}$/i.test(commandId))
        throw new Response("Invalid command ID", { status: 400 });
      if (!["delivery_address", "shipping_plan"].includes(input.kind))
        throw new Response("Invalid change kind", { status: 400 });
      const requested = requestContent(input.kind, input.requested);
      if (
        !Array.isArray(input.shipments) ||
        input.shipments.length < 1 ||
        input.shipments.length > 20 ||
        new Set(input.shipments.map((item) => item.shipmentId)).size !==
          input.shipments.length ||
        input.shipments.some(
          (item) =>
            !item.shipmentId ||
            item.shipmentId.length > 200 ||
            !Number.isSafeInteger(item.expectedVersion) ||
            item.expectedVersion < 1,
        )
      )
        throw new Response("Select current shipments", { status: 400 });
      const commandHash = await hash(
        JSON.stringify({
          profileId,
          orderId,
          kind: input.kind,
          requested,
          shipments: input.shipments,
        }),
      );
      const replay = await db
        .prepare(
          `SELECT id,submission_hash FROM order_shipping_change_requests
           WHERE submission_command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; submission_hash: string }>();
      if (replay) {
        if (replay.submission_hash !== commandHash) throw conflict();
        return replay.id;
      }
      await assertOwned(profileId, orderId);
      const shipments = (
        await db
          .prepare(
            `SELECT shipment.id,shipment.version,shipment.status,
               allocation.line_id,allocation.physical_quantity
             FROM order_shipments shipment
             JOIN order_shipment_allocations allocation
               ON allocation.shipment_id=shipment.id
             JOIN order_fulfillment_plans plan ON plan.order_id=shipment.order_id
             WHERE shipment.order_id=? AND plan.status='ready'`,
          )
          .bind(orderId)
          .all<ShipmentRow>()
      ).results;
      const selected = input.shipments.map((item) => {
        const rows = shipments.filter((row) => row.id === item.shipmentId);
        if (
          !rows.length ||
          rows[0].version !== item.expectedVersion ||
          !["planned", "ready_to_ship"].includes(rows[0].status)
        )
          throw conflict();
        return { ...item, allocations: rows };
      });
      const id = crypto.randomUUID();
      const timestamp = now();
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO order_shipping_change_requests
             (id,order_id,profile_id,kind,status,requested_json,
              submission_command_id,submission_hash,created_at,updated_at)
             VALUES (?,?,?,?,'pending_review',?,?,?,?,?)`,
          )
          .bind(
            id,
            orderId,
            profileId,
            input.kind,
            JSON.stringify(requested),
            commandId,
            commandHash,
            timestamp,
            timestamp,
          ),
      ];
      for (const shipment of selected) {
        statements.push(
          db
            .prepare(
              `INSERT INTO order_shipping_change_shipments
               (request_id,order_id,shipment_id,shipment_version,quantities_json)
               VALUES (?,?,?,?,?)`,
            )
            .bind(
              id,
              orderId,
              shipment.shipmentId,
              shipment.expectedVersion,
              JSON.stringify(
                shipment.allocations.map((allocation) => ({
                  lineId: allocation.line_id,
                  physicalQuantity: allocation.physical_quantity,
                })),
              ),
            ),
          db
            .prepare(
              `INSERT INTO order_shipping_change_active_shipments
               (shipment_id,request_id) VALUES (?,?)`,
            )
            .bind(shipment.shipmentId, id),
        );
        for (const allocation of shipment.allocations) {
          const holdId = crypto.randomUUID();
          statements.push(
            db
              .prepare(
                `INSERT INTO order_quantity_holds
                 (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
                 VALUES (?,?,?,?,?,'shipping_change',?,?)`,
              )
              .bind(
                holdId,
                orderId,
                allocation.line_id,
                shipment.shipmentId,
                allocation.physical_quantity,
                `Order change ${id}`,
                timestamp,
              ),
            db
              .prepare(
                `INSERT INTO order_shipping_change_hold_links(request_id,hold_id)
                 VALUES (?,?)`,
              )
              .bind(id, holdId),
          );
        }
      }
      statements.push(
        db
          .prepare(
            `INSERT INTO order_shipping_change_events
             (id,request_id,kind,details_json,actor_id,occurred_at,command_id)
             VALUES (? ,?,'submitted',?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            id,
            JSON.stringify({
              kind: input.kind,
              shipmentIds: selected.map((shipment) => shipment.shipmentId),
            }),
            profileId,
            timestamp,
            commandId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES (?,'order.shipping_change_requested','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `shipping-change-request:${id}`,
            orderId,
            profileId,
            JSON.stringify({
              requestId: id,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
          ),
      );
      try {
        await db.batch(statements);
      } catch {
        const concurrentReplay = await db
          .prepare(
            `SELECT id,submission_hash FROM order_shipping_change_requests
             WHERE submission_command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; submission_hash: string }>();
        if (concurrentReplay?.submission_hash === commandHash)
          return concurrentReplay.id;
        throw conflict();
      }
      return id;
    },
    async adminPropose(
      actor: AdminIdentity,
      input: {
        orderId: string;
        requestId: string;
        expectedVersion: number;
        shipments: unknown[];
        adjustmentCents: number;
        reason: string;
        expiresAt: string;
        commandId: string;
      },
    ) {
      const order = await assertAdmin(actor, input.orderId);
      const requestId = text(input.requestId, "Change request ID", 200);
      const commandId = text(input.commandId, "Command ID", 100);
      const reason = text(input.reason, "Review reason", 2000);
      if (
        !Number.isSafeInteger(input.adjustmentCents) ||
        Math.abs(input.adjustmentCents) > 100_000_000
      )
        throw new Response("Invalid USD adjustment", { status: 400 });
      const expiresAt = new Date(input.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date(now()))
        throw new Response("A future expiry is required", { status: 400 });
      const afterShipments = input.shipments.map(reviewedShipment);
      const commandHash = await hash(
        JSON.stringify({
          ...input,
          shipments: afterShipments,
          actorId: actor.id,
        }),
      );
      const replay = await db
        .prepare(
          `SELECT id,command_hash FROM order_shipping_change_proposals
         WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; command_hash: string }>();
      if (replay) {
        if (replay.command_hash !== commandHash) throw conflict();
        return replay.id;
      }
      const request = await currentRequest(input.orderId, requestId);
      if (
        request.version !== input.expectedVersion ||
        !["pending_review", "proposed", "accepted"].includes(request.status)
      )
        throw conflict();
      const affected = (
        await db
          .prepare(
            `SELECT shipment_id FROM order_shipping_change_shipments
         WHERE request_id=? ORDER BY shipment_id`,
          )
          .bind(requestId)
          .all<{ shipment_id: string }>()
      ).results.map((row) => row.shipment_id);
      if (
        affected.length !== afterShipments.length ||
        affected.some(
          (id) => !afterShipments.some((item) => item.shipmentId === id),
        )
      )
        throw new Response("Proposal must include each affected shipment", {
          status: 400,
        });
      const before = {
        shipments: await beforeShipments(input.orderId, affected),
      };
      if (
        before.shipments.some(
          (shipment) =>
            shipment.readyDate &&
            !afterShipments.find(
              (item) => item.shipmentId === shipment.shipmentId,
            )?.readyDate,
        )
      )
        throw new Response("A revised ready date is required", {
          status: 400,
        });
      const totals = (items: ProposedShipment[]) => {
        const map = new Map<string, number>();
        for (const item of items)
          for (const allocation of item.allocations)
            map.set(
              allocation.lineId,
              (map.get(allocation.lineId) ?? 0) + allocation.physicalQuantity,
            );
        return [...map].sort(([a], [b]) => a.localeCompare(b));
      };
      if (
        JSON.stringify(totals(before.shipments)) !==
        JSON.stringify(totals(afterShipments))
      )
        throw new Response(
          "A shipping change cannot alter purchased quantities",
          { status: 400 },
        );
      if (
        JSON.stringify(
          before.shipments.map(
            ({
              shipmentVersion: _version,
              scheduleVersion: _schedule,
              ...terms
            }) => terms,
          ),
        ) === JSON.stringify(afterShipments)
      )
        throw new Response("Proposal must change at least one shipping term", {
          status: 400,
        });
      const proposalId = crypto.randomUUID();
      const version =
        (
          await db
            .prepare(
              `SELECT coalesce(max(version),0)+1 AS next FROM order_shipping_change_proposals
         WHERE request_id=?`,
            )
            .bind(requestId)
            .first<{ next: number }>()
        )?.next ?? 1;
      const after = { shipments: afterShipments };
      const proposalHash = await hash(
        JSON.stringify({
          requestId,
          version,
          before,
          after,
          adjustmentCents: input.adjustmentCents,
          reason,
          expiresAt: expiresAt.toISOString(),
        }),
      );
      const timestamp = now();
      const messageId = `shipping-change-proposal:${proposalId}`;
      const body = `An Order Change Confirmation is ready for your review. Open Order ${input.orderId} to accept or contact Support. No change takes effect until you accept the current version and the seller applies it.`;
      try {
        const results = await db.batch([
          db
            .prepare(
              `UPDATE order_shipping_change_requests SET status='proposed',
             current_proposal_id=?,version=version+1,updated_at=?
             WHERE id=? AND order_id=? AND version=?
               AND status IN ('pending_review','proposed','accepted')`,
            )
            .bind(
              proposalId,
              timestamp,
              requestId,
              input.orderId,
              input.expectedVersion,
            ),
          db
            .prepare(
              `INSERT INTO order_shipping_change_proposals
             (id,request_id,version,before_json,after_json,adjustment_cents,
              reason,expires_at,proposal_hash,command_id,command_hash,actor_id,published_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              proposalId,
              requestId,
              version,
              JSON.stringify(before),
              JSON.stringify(after),
              input.adjustmentCents,
              reason,
              expiresAt.toISOString(),
              proposalHash,
              commandId,
              commandHash,
              actor.id,
              timestamp,
            ),
          db
            .prepare(
              `INSERT INTO order_shipping_change_events
             (id,request_id,kind,details_json,actor_id,occurred_at,command_id)
             SELECT ?,?,'proposed',?,?,?,?
             WHERE EXISTS(SELECT 1 FROM order_shipping_change_proposals WHERE id=?)`,
            )
            .bind(
              crypto.randomUUID(),
              requestId,
              JSON.stringify({
                proposalId,
                version,
                adjustmentCents: input.adjustmentCents,
              }),
              actor.id,
              timestamp,
              commandId,
              proposalId,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'order.shipping_change_proposed','confirmed_order',?,?,?,?
             WHERE EXISTS(SELECT 1 FROM order_shipping_change_proposals WHERE id=?)`,
            )
            .bind(
              `shipping-change-proposed:${proposalId}`,
              input.orderId,
              actor.id,
              JSON.stringify({
                requestId,
                proposalId,
                commandId,
                ipAddress: options.auditIp ?? null,
              }),
              timestamp,
              proposalId,
            ),
          ...(await changeMessage(
            requestId,
            actor.id,
            order.request_id,
            body,
            timestamp,
            messageId,
            commandId,
          )),
        ]);
        if (results[0].meta.changes !== 1) throw conflict();
      } catch (error) {
        if (error instanceof Response) throw error;
        throw conflict();
      }
      return proposalId;
    },
    async customerAccept(
      profileId: string,
      input: {
        orderId: string;
        requestId: string;
        proposalId: string;
        proposalHash: string;
        expectedVersion: number;
        commandId: string;
      },
    ) {
      await assertOwned(profileId, input.orderId);
      const commandId = text(input.commandId, "Command ID", 100);
      const commandHash = await hash(JSON.stringify({ ...input, profileId }));
      const replay = await db
        .prepare(
          `SELECT id,command_hash FROM order_shipping_change_acceptances
         WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; command_hash: string }>();
      if (replay) {
        if (replay.command_hash !== commandHash) throw conflict();
        return replay.id;
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO order_shipping_change_acceptances
             (id,request_id,proposal_id,profile_id,proposal_hash,
              command_id,command_hash,accepted_at)
             SELECT ?,request.id,proposal.id,?,?,?, ?,?
             FROM order_shipping_change_requests request
             JOIN order_shipping_change_proposals proposal
               ON proposal.id=request.current_proposal_id
             WHERE request.id=? AND request.order_id=?
               AND request.status='proposed' AND request.version=?
               AND request.current_proposal_id=?
               AND proposal.proposal_hash=? AND proposal.expires_at>?
               AND NOT EXISTS(SELECT 1 FROM order_shipping_change_acceptances
                 WHERE proposal_id=proposal.id)`,
            )
            .bind(
              id,
              profileId,
              input.proposalHash,
              commandId,
              commandHash,
              timestamp,
              input.requestId,
              input.orderId,
              input.expectedVersion,
              input.proposalId,
              input.proposalHash,
              timestamp,
            ),
          db
            .prepare(
              `UPDATE order_shipping_change_requests
             SET status='accepted',version=version+1,updated_at=?
             WHERE id=? AND status='proposed' AND version=?
               AND EXISTS(SELECT 1 FROM order_shipping_change_acceptances
                 WHERE id=? AND request_id=order_shipping_change_requests.id)`,
            )
            .bind(timestamp, input.requestId, input.expectedVersion, id),
          db
            .prepare(
              `INSERT INTO order_shipping_change_events
             (id,request_id,kind,details_json,actor_id,occurred_at,command_id)
             SELECT ?,?,'accepted',?,?,?,?
             WHERE EXISTS(SELECT 1 FROM order_shipping_change_acceptances WHERE id=?)`,
            )
            .bind(
              crypto.randomUUID(),
              input.requestId,
              JSON.stringify({
                proposalId: input.proposalId,
                proposalHash: input.proposalHash,
              }),
              profileId,
              timestamp,
              commandId,
              id,
            ),
        ]);
        if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
          throw conflict();
      } catch (error) {
        if (error instanceof Response) throw error;
        throw conflict();
      }
      return id;
    },
    async customerWithdraw(
      profileId: string,
      input: {
        orderId: string;
        requestId: string;
        expectedVersion: number;
        commandId: string;
        reason: string;
      },
    ) {
      const order = await assertOwned(profileId, input.orderId);
      await closeRequest(input, profileId, "withdrawn", order.request_id);
    },
    async adminDecline(
      actor: AdminIdentity,
      input: {
        orderId: string;
        requestId: string;
        expectedVersion: number;
        commandId: string;
        reason: string;
      },
    ) {
      const order = await assertAdmin(actor, input.orderId);
      await closeRequest(input, actor.id, "declined", order.request_id);
    },
    async adminApply(
      actor: AdminIdentity,
      input: {
        orderId: string;
        requestId: string;
        proposalId: string;
        expectedVersion: number;
        commandId: string;
      },
    ) {
      const order = await assertAdmin(actor, input.orderId);
      const commandId = text(input.commandId, "Command ID", 100);
      const prior = await db
        .prepare(
          `SELECT id,request_id,proposal_id FROM order_shipping_change_effective
         WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; request_id: string; proposal_id: string }>();
      if (prior) {
        if (
          prior.request_id !== input.requestId ||
          prior.proposal_id !== input.proposalId
        )
          throw conflict();
        return prior.id;
      }
      const request = await currentRequest(input.orderId, input.requestId);
      if (
        request.status !== "accepted" ||
        request.version !== input.expectedVersion ||
        request.current_proposal_id !== input.proposalId
      )
        throw conflict();
      const proposal = await db
        .prepare(
          `SELECT before_json,after_json,adjustment_cents,proposal_hash,expires_at
         FROM order_shipping_change_proposals
         WHERE id=? AND request_id=?`,
        )
        .bind(input.proposalId, input.requestId)
        .first<{
          before_json: string;
          after_json: string;
          adjustment_cents: number;
          proposal_hash: string;
          expires_at: string;
        }>();
      if (!proposal) throw conflict();
      const accepted = await db
        .prepare(
          `SELECT id FROM order_shipping_change_acceptances
         WHERE proposal_id=? AND proposal_hash=?`,
        )
        .bind(input.proposalId, proposal.proposal_hash)
        .first();
      if (!accepted) throw conflict();
      const before = JSON.parse(proposal.before_json) as {
        shipments: Array<
          ProposedShipment & {
            shipmentVersion: number;
            scheduleVersion: number | null;
          }
        >;
      };
      const after = JSON.parse(proposal.after_json) as {
        shipments: ProposedShipment[];
      };
      const current = await beforeShipments(
        input.orderId,
        before.shipments.map((shipment) => shipment.shipmentId),
      );
      if (JSON.stringify(current) !== JSON.stringify(before.shipments))
        throw conflict();
      const timestamp = now();
      const effectId = crypto.randomUUID();
      const messageId = `shipping-change-effective:${effectId}`;
      const body = `The accepted Order Change Confirmation for Order ${input.orderId} is now effective. Your original PI remains unchanged. Review the current shipment details in your account.`;
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO order_shipping_change_effective
           (id,order_id,request_id,proposal_id,proposal_hash,
            before_json,after_json,adjustment_cents,effective_at,command_id)
           SELECT ?,?,?,?,?,?,?,?,?,?
           WHERE EXISTS(SELECT 1 FROM order_shipping_change_requests
             WHERE id=? AND status='accepted' AND version=?
               AND current_proposal_id=?)`,
          )
          .bind(
            effectId,
            input.orderId,
            input.requestId,
            input.proposalId,
            proposal.proposal_hash,
            proposal.before_json,
            proposal.after_json,
            proposal.adjustment_cents,
            timestamp,
            commandId,
            input.requestId,
            input.expectedVersion,
            input.proposalId,
          ),
        db
          .prepare(
            `UPDATE order_quantity_holds SET active=0,resolved_at=?
           WHERE active=1 AND id IN (SELECT hold_id FROM order_shipping_change_hold_links
             WHERE request_id=?)`,
          )
          .bind(timestamp, input.requestId),
        db
          .prepare(
            `INSERT INTO order_shipping_change_allocation_edit_context
           (order_id,effective_change_id)
           VALUES (?,?)`,
          )
          .bind(input.orderId, effectId),
      ];
      const changedAllocations: ProposedShipment[] = [];
      for (const original of before.shipments) {
        const revised = after.shipments.find(
          (item) => item.shipmentId === original.shipmentId,
        );
        if (!revised) throw conflict();
        const oldAllocations = [...original.allocations].sort((a, b) =>
          a.lineId.localeCompare(b.lineId),
        );
        const newAllocations = [...revised.allocations].sort((a, b) =>
          a.lineId.localeCompare(b.lineId),
        );
        if (JSON.stringify(oldAllocations) !== JSON.stringify(newAllocations)) {
          changedAllocations.push(revised);
          statements.push(
            db
              .prepare(
                `DELETE FROM order_shipment_allocations
             WHERE shipment_id=? AND order_id=?`,
              )
              .bind(original.shipmentId, input.orderId),
          );
        }
      }
      for (const revised of changedAllocations)
        for (const allocation of revised.allocations)
          statements.push(
            db
              .prepare(
                `INSERT INTO order_shipment_allocations
             (shipment_id,order_id,line_id,physical_quantity)
             VALUES (?,?,?,?)`,
              )
              .bind(
                revised.shipmentId,
                input.orderId,
                allocation.lineId,
                allocation.physicalQuantity,
              ),
          );
      statements.push(
        db
          .prepare(
            `DELETE FROM order_shipping_change_allocation_edit_context
         WHERE order_id=? AND effective_change_id=?`,
          )
          .bind(input.orderId, effectId),
      );
      for (const original of before.shipments) {
        const revised = after.shipments.find(
          (item) => item.shipmentId === original.shipmentId,
        )!;
        const {
          shipmentVersion: _shipmentVersion,
          scheduleVersion: _scheduleVersion,
          ...originalTerms
        } = original;
        if (JSON.stringify(originalTerms) === JSON.stringify(revised)) continue;
        statements.push(
          db
            .prepare(
              `UPDATE order_shipments SET version=version+1,updated_at=?
           WHERE id=? AND order_id=? AND version=?
             AND status IN ('planned','ready_to_ship')`,
            )
            .bind(
              timestamp,
              original.shipmentId,
              input.orderId,
              original.shipmentVersion,
            ),
        );
        statements.push(
          db
            .prepare(
              `INSERT INTO order_shipping_change_reverification
           (shipment_id,effective_change_id,required_at)
           SELECT id,?,? FROM order_shipments
           WHERE id=? AND order_id=? AND status='ready_to_ship'
           ON CONFLICT(shipment_id) DO UPDATE SET
             effective_change_id=excluded.effective_change_id,
             required_at=excluded.required_at,verified_at=NULL,
             verified_by=NULL,verification_json=NULL`,
            )
            .bind(effectId, timestamp, original.shipmentId, input.orderId),
        );
        if (original.readyDate !== revised.readyDate && revised.readyDate) {
          statements.push(
            db
              .prepare(
                `UPDATE order_shipment_ready_schedules
             SET current_estimate_date=?,current_estimate_source='revised',
               version=version+1,updated_at=?
             WHERE shipment_id=? AND order_id=? AND version=?`,
              )
              .bind(
                revised.readyDate,
                timestamp,
                original.shipmentId,
                input.orderId,
                original.scheduleVersion,
              ),
          );
          statements.push(
            db
              .prepare(
                `INSERT INTO order_shipment_ready_schedule_revisions
             (id,shipment_id,order_id,previous_date,new_date,source,
              reason,actor_id,previous_version,resulting_version,occurred_at,command_id)
             VALUES (?,?,?, ?,?,'revised',?,?,?, ?,?,?)`,
              )
              .bind(
                crypto.randomUUID(),
                original.shipmentId,
                input.orderId,
                original.readyDate,
                revised.readyDate,
                `Accepted Order Change Confirmation ${input.proposalId}`,
                actor.id,
                original.scheduleVersion,
                (original.scheduleVersion ?? 0) + 1,
                timestamp,
                `${commandId}:${original.shipmentId}:date`,
              ),
          );
        }
      }
      statements.push(
        db
          .prepare(
            `UPDATE order_shipping_change_requests SET status='effective',
           version=version+1,updated_at=?
           WHERE id=? AND status='accepted' AND version=?
             AND current_proposal_id=?`,
          )
          .bind(
            timestamp,
            input.requestId,
            input.expectedVersion,
            input.proposalId,
          ),
        db
          .prepare(
            `DELETE FROM order_shipping_change_active_shipments
           WHERE request_id=?`,
          )
          .bind(input.requestId),
      );
      if (proposal.adjustment_cents < 0)
        statements.push(
          db
            .prepare(
              `INSERT INTO order_shipping_change_refund_reservations
         (id,effective_change_id,order_id,due_cents,reserved_at)
         VALUES (?,?,?,?,?)`,
            )
            .bind(
              crypto.randomUUID(),
              effectId,
              input.orderId,
              -proposal.adjustment_cents,
              timestamp,
            ),
        );
      statements.push(
        db
          .prepare(
            `INSERT INTO order_shipping_change_events
           (id,request_id,kind,details_json,actor_id,occurred_at,command_id)
           VALUES (?,?,'applied',?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            input.requestId,
            JSON.stringify({
              effectId,
              proposalId: input.proposalId,
              adjustmentCents: proposal.adjustment_cents,
              additionalFundsVerifiedInSystem: false,
            }),
            actor.id,
            timestamp,
            commandId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
           (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
           VALUES (?,'order.shipping_change_effective','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `shipping-change-effective:${effectId}`,
            input.orderId,
            actor.id,
            JSON.stringify({
              requestId: input.requestId,
              proposalId: input.proposalId,
              commandId,
              ipAddress: options.auditIp ?? null,
              additionalFundsVerifiedInSystem: false,
            }),
            timestamp,
          ),
        ...(await changeMessage(
          input.requestId,
          actor.id,
          order.request_id,
          body,
          timestamp,
          messageId,
          commandId,
        )),
      );
      try {
        const results = await db.batch(statements);
        if (results[0].meta.changes !== 1) throw conflict();
      } catch (error) {
        const replay = await db
          .prepare(
            `SELECT id,request_id,proposal_id FROM order_shipping_change_effective
           WHERE command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; request_id: string; proposal_id: string }>();
        if (
          replay?.request_id === input.requestId &&
          replay.proposal_id === input.proposalId
        )
          return replay.id;
        if (error instanceof Response) throw error;
        throw conflict();
      }
      return effectId;
    },
    async adminVerifyRevisedReady(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        effectiveChangeId: string;
        expectedShipmentVersion: number;
        commandId: string;
        verification: {
          specificationsVerified: boolean;
          quantitiesVerified: boolean;
          offlinePreparationVerified: boolean;
          requiredInspectionVerified: boolean;
        };
      },
    ) {
      await assertAdmin(actor, input.orderId);
      if (Object.values(input.verification).some((value) => value !== true))
        throw new Response("Complete every readiness check", { status: 400 });
      const eventId = `shipping-change-reverified:${text(input.commandId, "Command ID", 100)}`;
      const replay = await db
        .prepare(
          `SELECT entity_id,payload_json FROM admin_audit_events WHERE id=?`,
        )
        .bind(eventId)
        .first<{ entity_id: string; payload_json: string }>();
      if (replay) {
        const payload = JSON.parse(replay.payload_json) as {
          shipmentId: string;
          effectiveChangeId: string;
        };
        if (
          replay.entity_id !== input.orderId ||
          payload.shipmentId !== input.shipmentId ||
          payload.effectiveChangeId !== input.effectiveChangeId
        )
          throw conflict();
        return;
      }
      const timestamp = now();
      try {
        const results = await db.batch([
          db
            .prepare(
              `UPDATE order_shipping_change_reverification
             SET verified_at=?,verified_by=?,verification_json=?
             WHERE shipment_id=? AND effective_change_id=? AND verified_at IS NULL
               AND EXISTS(SELECT 1 FROM order_shipments shipment
                 WHERE shipment.id=order_shipping_change_reverification.shipment_id
                   AND shipment.order_id=? AND shipment.status='ready_to_ship'
                   AND shipment.version=?)
               AND NOT EXISTS(SELECT 1 FROM order_release_guards guard
                 WHERE guard.order_id=? AND guard.held=1)
               AND NOT EXISTS(SELECT 1 FROM order_quantity_holds hold
                 WHERE hold.shipment_id=? AND hold.active=1)`,
            )
            .bind(
              timestamp,
              actor.id,
              JSON.stringify(input.verification),
              input.shipmentId,
              input.effectiveChangeId,
              input.orderId,
              input.expectedShipmentVersion,
              input.orderId,
              input.shipmentId,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'order.shipping_change_reverified','confirmed_order',?,?,?,?
             WHERE changes()=1`,
            )
            .bind(
              eventId,
              input.orderId,
              actor.id,
              JSON.stringify({
                requestId: input.commandId,
                ipAddress: options.auditIp ?? null,
                shipmentId: input.shipmentId,
                effectiveChangeId: input.effectiveChangeId,
                shipmentVersion: input.expectedShipmentVersion,
                verification: input.verification,
              }),
              timestamp,
            ),
        ]);
        if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
          throw conflict();
      } catch (error) {
        if (error instanceof Response) throw error;
        throw conflict();
      }
    },
  };
}
