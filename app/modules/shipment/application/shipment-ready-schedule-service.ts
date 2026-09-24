import type { AdminIdentity } from "#workers/admin-access";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { createChinaCalendarService } from "./china-calendar-service";
import {
  committedReadyDate,
  validatedReadySchedule,
  type ReadyScheduleBasis,
} from "../domain/ready-schedule";

interface ScheduleRow {
  shipment_id: string;
  group_key: string;
  display_name: string;
  shipment_status: "planned" | "ready_to_ship" | "shipped" | "delivered";
  shipment_version: number;
  accepted_basis_json: string | null;
  accepted_ready_date: string | null;
  accepted_calendar_version: number | null;
  current_estimate_date: string | null;
  current_estimate_source: "accepted" | "operational" | "revised" | null;
  version: number;
}

interface RevisionRow {
  id: string;
  shipment_id: string;
  previous_date: string | null;
  new_date: string;
  source: "operational" | "revised";
  reason: string;
  actor_id: string;
  previous_version: number;
  resulting_version: number;
  occurred_at: string;
  command_id: string;
}

function assertAdmin(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}

export function createShipmentReadyScheduleService(db: D1Database) {
  async function ensureRows(orderId: string) {
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO order_shipment_ready_schedules
         (shipment_id,order_id,accepted_basis_json,created_at,updated_at)
         SELECT s.id,s.order_id,json_extract(s.accepted_terms_json,'$.readySchedule'),?,?
         FROM order_shipments s WHERE s.order_id=?
         ON CONFLICT(shipment_id) DO NOTHING`,
      )
      .bind(now, now, orderId)
      .run();
  }

  async function rows(orderId: string) {
    const shipments = (
      await db
        .prepare(
          `SELECT s.id AS shipment_id,s.group_key,s.display_name,
             s.status AS shipment_status,s.version AS shipment_version,
             ready.accepted_basis_json,ready.accepted_ready_date,
             ready.accepted_calendar_version,ready.current_estimate_date,
             ready.current_estimate_source,ready.version
           FROM order_shipments s
           JOIN order_shipment_ready_schedules ready ON ready.shipment_id=s.id
           WHERE s.order_id=? ORDER BY s.sequence_number`,
        )
        .bind(orderId)
        .all<ScheduleRow>()
    ).results;
    const history = (
      await db
        .prepare(
          `SELECT id,shipment_id,previous_date,new_date,source,reason,actor_id,
             previous_version,resulting_version,occurred_at,command_id
           FROM order_shipment_ready_schedule_revisions
           WHERE order_id=? ORDER BY occurred_at,id`,
        )
        .bind(orderId)
        .all<RevisionRow>()
    ).results;
    return shipments.map((item) => ({
      shipmentId: item.shipment_id,
      groupKey: item.group_key,
      displayName: item.display_name,
      shipmentStatus: item.shipment_status,
      shipmentVersion: item.shipment_version,
      acceptedBasis: item.accepted_basis_json
        ? (JSON.parse(item.accepted_basis_json) as ReadyScheduleBasis)
        : null,
      acceptedReadyDate: item.accepted_ready_date,
      acceptedCalendarVersion: item.accepted_calendar_version,
      currentEstimateDate: item.current_estimate_date,
      currentEstimateSource: item.current_estimate_source,
      version: item.version,
      history: history
        .filter((revision) => revision.shipment_id === item.shipment_id)
        .map((revision) => ({
          id: revision.id,
          previousDate: revision.previous_date,
          newDate: revision.new_date,
          source: revision.source,
          reason: revision.reason,
          actorId: revision.actor_id,
          previousVersion: revision.previous_version,
          version: revision.resulting_version,
          occurredAt: revision.occurred_at,
        })),
    }));
  }

  return {
    async adminRead(actor: AdminIdentity, orderId: string) {
      assertAdmin(actor);
      const order = await db
        .prepare("SELECT id FROM confirmed_orders WHERE id=?")
        .bind(orderId)
        .first();
      if (!order) throw new Response("Order not found", { status: 404 });
      await ensureRows(orderId);
      return rows(orderId);
    },
    async customerRead(profileId: string, orderId: string) {
      if (!profileId) throw new Response("Forbidden", { status: 403 });
      const owned = await db
        .prepare(
          `SELECT o.id FROM confirmed_orders o
           JOIN customer_quote_requests request ON request.id=o.request_id
           ${ownedQuoteRequestWhere} AND o.id=?`,
        )
        .bind(profileId, profileId, profileId, orderId)
        .first();
      if (!owned) throw new Response("Order not found", { status: 404 });
      await ensureRows(orderId);
      return rows(orderId);
    },
    async resolveAccepted(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        expectedVersion: number;
        expectedShipmentVersion: number;
        commandId: string;
      },
    ) {
      assertAdmin(actor);
      if (!/^[0-9a-f-]{36}$/.test(input.commandId))
        throw new Response("Command identity required", { status: 400 });
      const eventId = `shipment-ready-resolve:${input.commandId}`;
      const prior = await db
        .prepare(
          "SELECT actor_id,entity_id,payload_json FROM admin_audit_events WHERE id=?",
        )
        .bind(eventId)
        .first<{ actor_id: string; entity_id: string; payload_json: string }>();
      if (prior) {
        const payload = JSON.parse(prior.payload_json) as {
          orderId: string;
          previousVersion: number;
          previousShipmentVersion: number;
          resultingVersion: number;
        };
        if (
          prior.actor_id !== actor.id ||
          prior.entity_id !== input.shipmentId ||
          payload.orderId !== input.orderId ||
          payload.previousVersion !== input.expectedVersion ||
          payload.previousShipmentVersion !== input.expectedShipmentVersion
        )
          throw new Response("Command identity conflict", { status: 409 });
        return payload.resultingVersion;
      }
      await ensureRows(input.orderId);
      const row = await db
        .prepare(
          `SELECT ready.version,ready.accepted_basis_json,
             ready.accepted_ready_date,ready.current_estimate_date,
             s.version AS shipment_version,s.status AS shipment_status,
             s.display_name,o.confirmed_at,o.request_id
           FROM order_shipment_ready_schedules ready
           JOIN order_shipments s ON s.id=ready.shipment_id
           JOIN confirmed_orders o ON o.id=ready.order_id
           WHERE ready.order_id=? AND ready.shipment_id=?`,
        )
        .bind(input.orderId, input.shipmentId)
        .first<{
          version: number;
          accepted_basis_json: string | null;
          accepted_ready_date: string | null;
          current_estimate_date: string | null;
          shipment_version: number;
          shipment_status: string;
          display_name: string;
          confirmed_at: string;
          request_id: string;
        }>();
      if (!row) throw new Response("Shipment not found", { status: 404 });
      if (
        row.version !== input.expectedVersion ||
        row.shipment_version !== input.expectedShipmentVersion ||
        !["planned", "ready_to_ship"].includes(row.shipment_status) ||
        row.accepted_ready_date ||
        row.current_estimate_date
      )
        throw new Response("Shipment schedule changed; reload", {
          status: 409,
        });
      const basis = row.accepted_basis_json
        ? validatedReadySchedule(JSON.parse(row.accepted_basis_json))
        : null;
      if (basis?.kind !== "china_business_days")
        throw new Response("No unresolved accepted schedule", { status: 409 });
      const calendar = await createChinaCalendarService(db).read();
      let computed;
      try {
        computed = committedReadyDate(row.confirmed_at, basis, calendar);
      } catch {
        throw new Response(
          "Publish a China fulfillment calendar covering this commitment first",
          { status: 409 },
        );
      }
      const now = new Date().toISOString();
      const messageId = `shipment-ready-commitment:${input.commandId}`;
      const body = `The accepted ready-to-ship commitment for ${row.display_name} is ${computed.date}, calculated from the agreed ${basis.days} China fulfillment business days after Order confirmation.`;
      const messageHash = await piSha256(new TextEncoder().encode(body));
      try {
        await db.batch([
          db
            .prepare(
              `UPDATE order_shipment_ready_schedules
               SET accepted_ready_date=?,accepted_calendar_version=?,
                 current_estimate_date=?,current_estimate_source='accepted',
                 version=version+1,updated_at=?
               WHERE shipment_id=? AND order_id=? AND version=?
                 AND accepted_ready_date IS NULL AND current_estimate_date IS NULL
                 AND EXISTS(SELECT 1 FROM order_shipments s
                   WHERE s.id=? AND s.version=? AND s.status IN ('planned','ready_to_ship'))`,
            )
            .bind(
              computed.date,
              computed.calendarVersion,
              computed.date,
              now,
              input.shipmentId,
              input.orderId,
              input.expectedVersion,
              input.shipmentId,
              input.expectedShipmentVersion,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events
               (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
               SELECT ?,'shipment.ready_commitment_resolved','shipment',?,?,?,?
               WHERE changes()=1`,
            )
            .bind(
              eventId,
              input.shipmentId,
              actor.id,
              JSON.stringify({
                orderId: input.orderId,
                previousVersion: input.expectedVersion,
                previousShipmentVersion: input.expectedShipmentVersion,
                resultingVersion: input.expectedVersion + 1,
                acceptedBasis: basis,
                acceptedReadyDate: computed.date,
                calendarVersion: computed.calendarVersion,
              }),
              now,
            ),
          db
            .prepare(
              `INSERT INTO quote_conversations(request_id,created_at)
               SELECT request_id,? FROM confirmed_orders WHERE id=?
                 AND EXISTS(SELECT 1 FROM admin_audit_events WHERE id=?)
               ON CONFLICT(request_id) DO NOTHING`,
            )
            .bind(now, input.orderId, eventId),
          db
            .prepare(
              `INSERT INTO quote_conversation_messages
               (id,request_id,author_role,author_id,body,created_at,command_id,
                 payload_hash,source,delivery_state)
               SELECT ?,o.request_id,'admin',?,?,?,?,?,'website','available'
               FROM confirmed_orders o WHERE o.id=?
                 AND EXISTS(SELECT 1 FROM admin_audit_events WHERE id=?)
               ON CONFLICT(command_id) DO NOTHING`,
            )
            .bind(
              messageId,
              actor.id,
              body,
              now,
              messageId,
              messageHash,
              input.orderId,
              eventId,
            ),
          quoteNotificationOutboxStatement(db, {
            messageId,
            requestId: row.request_id,
            createdAt: now,
          }),
        ]);
      } catch (error) {
        const receipt = await db
          .prepare("SELECT payload_json FROM admin_audit_events WHERE id=?")
          .bind(eventId)
          .first<{ payload_json: string }>();
        if (receipt)
          return (
            JSON.parse(receipt.payload_json) as { resultingVersion: number }
          ).resultingVersion;
        throw error;
      }
      const receipt = await db
        .prepare("SELECT payload_json FROM admin_audit_events WHERE id=?")
        .bind(eventId)
        .first<{ payload_json: string }>();
      if (!receipt)
        throw new Response("Shipment schedule changed; reload", {
          status: 409,
        });
      return (JSON.parse(receipt.payload_json) as { resultingVersion: number })
        .resultingVersion;
    },
    async revise(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        expectedVersion: number;
        expectedShipmentVersion: number;
        commandId: string;
        newDate: string;
        reason: string;
      },
    ) {
      assertAdmin(actor);
      if (!/^[0-9a-f-]{36}$/.test(input.commandId))
        throw new Response("Command identity required", { status: 400 });
      const schedule = validatedReadySchedule({
        kind: "fixed_date",
        readyDate: input.newDate,
      });
      if (schedule.kind !== "fixed_date")
        throw new Response("A fixed ready date is required", { status: 400 });
      const date = schedule.readyDate;
      const reason = input.reason.trim();
      if (reason.length < 10 || reason.length > 2000)
        throw new Response("A reviewed date-change reason is required", {
          status: 400,
        });
      const prior = await db
        .prepare(
          `SELECT actor_id,order_id,shipment_id,new_date,reason,previous_version,
             resulting_version FROM order_shipment_ready_schedule_revisions
           WHERE command_id=?`,
        )
        .bind(input.commandId)
        .first<RevisionRow & { order_id: string }>();
      if (prior) {
        if (
          prior.actor_id !== actor.id ||
          prior.order_id !== input.orderId ||
          prior.shipment_id !== input.shipmentId ||
          prior.new_date !== date ||
          prior.reason !== reason ||
          prior.previous_version !== input.expectedVersion
        )
          throw new Response("Command identity conflict", { status: 409 });
        return prior.resulting_version;
      }
      await ensureRows(input.orderId);
      const row = await db
        .prepare(
          `SELECT ready.*,s.display_name,s.status AS shipment_status,
             s.version AS shipment_version,o.request_id
           FROM order_shipment_ready_schedules ready
           JOIN order_shipments s ON s.id=ready.shipment_id
           JOIN confirmed_orders o ON o.id=ready.order_id
           WHERE ready.order_id=? AND ready.shipment_id=?`,
        )
        .bind(input.orderId, input.shipmentId)
        .first<{
          version: number;
          accepted_basis_json: string | null;
          current_estimate_date: string | null;
          shipment_status: string;
          shipment_version: number;
          display_name: string;
          request_id: string;
        }>();
      if (!row) throw new Response("Shipment not found", { status: 404 });
      if (
        row.version !== input.expectedVersion ||
        row.shipment_version !== input.expectedShipmentVersion ||
        !["planned", "ready_to_ship"].includes(row.shipment_status)
      )
        throw new Response("Shipment date changed or already dispatched", {
          status: 409,
        });
      if (row.accepted_basis_json && !row.current_estimate_date)
        throw new Response("Resolve the accepted calendar commitment first", {
          status: 409,
        });
      if (row.current_estimate_date === date)
        throw new Response("Choose a different estimated date", {
          status: 400,
        });
      const source = row.current_estimate_date ? "revised" : "operational";
      const now = new Date().toISOString();
      const messageId = `shipment-date:${input.commandId}`;
      const body =
        source === "operational"
          ? `A current estimated ready-to-ship date of ${date} has been provided for ${row.display_name}. This is an operational estimate, not an original PI commitment. Reason: ${reason}`
          : `The estimated ready-to-ship date for ${row.display_name} changed from ${row.current_estimate_date} to ${date}. Reason: ${reason}`;
      const messageHash = await piSha256(new TextEncoder().encode(body));
      try {
        await db.batch([
          db
            .prepare(
              `UPDATE order_shipment_ready_schedules
               SET current_estimate_date=?,current_estimate_source=?,
                 version=version+1,updated_at=?
               WHERE shipment_id=? AND order_id=? AND version=?
                 AND EXISTS(SELECT 1 FROM order_shipments s
                   WHERE s.id=? AND s.version=? AND s.status IN ('planned','ready_to_ship'))`,
            )
            .bind(
              date,
              source,
              now,
              input.shipmentId,
              input.orderId,
              input.expectedVersion,
              input.shipmentId,
              input.expectedShipmentVersion,
            ),
          db
            .prepare(
              `INSERT INTO order_shipment_ready_schedule_revisions
               (id,shipment_id,order_id,previous_date,new_date,source,reason,
                 actor_id,previous_version,resulting_version,occurred_at,command_id)
               SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1`,
            )
            .bind(
              `shipment-date:${input.commandId}`,
              input.shipmentId,
              input.orderId,
              row.current_estimate_date,
              date,
              source,
              reason,
              actor.id,
              input.expectedVersion,
              input.expectedVersion + 1,
              now,
              input.commandId,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events
               (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
               SELECT ?,'shipment.ready_date_revised','shipment',?,?,?,?
               WHERE EXISTS(SELECT 1 FROM order_shipment_ready_schedule_revisions
                 WHERE command_id=?)`,
            )
            .bind(
              `shipment-date-audit:${input.commandId}`,
              input.shipmentId,
              actor.id,
              JSON.stringify({
                previousDate: row.current_estimate_date,
                newDate: date,
                source,
                reason,
                previousVersion: input.expectedVersion,
              }),
              now,
              input.commandId,
            ),
          db
            .prepare(
              `INSERT INTO quote_conversations(request_id,created_at)
               SELECT request_id,? FROM confirmed_orders WHERE id=?
               ON CONFLICT(request_id) DO NOTHING`,
            )
            .bind(now, input.orderId),
          db
            .prepare(
              `INSERT INTO quote_conversation_messages
               (id,request_id,author_role,author_id,body,created_at,command_id,
                 payload_hash,source,delivery_state)
               SELECT ?,o.request_id,'admin',?,?,?,?,?,'website','available'
               FROM confirmed_orders o WHERE o.id=?
                 AND EXISTS(SELECT 1 FROM order_shipment_ready_schedule_revisions
                   WHERE command_id=?)
               ON CONFLICT(command_id) DO NOTHING`,
            )
            .bind(
              messageId,
              actor.id,
              body,
              now,
              messageId,
              messageHash,
              input.orderId,
              input.commandId,
            ),
          quoteNotificationOutboxStatement(db, {
            messageId,
            requestId: row.request_id,
            createdAt: now,
          }),
        ]);
      } catch (error) {
        const receipt = await db
          .prepare(
            "SELECT resulting_version FROM order_shipment_ready_schedule_revisions WHERE command_id=?",
          )
          .bind(input.commandId)
          .first<{ resulting_version: number }>();
        if (receipt) return receipt.resulting_version;
        throw error;
      }
      const receipt = await db
        .prepare(
          "SELECT resulting_version FROM order_shipment_ready_schedule_revisions WHERE command_id=?",
        )
        .bind(input.commandId)
        .first<{ resulting_version: number }>();
      if (!receipt)
        throw new Response("Shipment date changed; reload and retry", {
          status: 409,
        });
      return receipt.resulting_version;
    },
  };
}
