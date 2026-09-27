import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { requireAfterSalesPermission } from "../domain/permissions";
import {
  etDisplayDate,
  isOnOrBefore,
  raArrivalDeadline,
} from "../domain/return-policy";
import { customerMessageStatements } from "../infrastructure/d1-customer-messages";
import { createD1OrderFacts } from "../infrastructure/d1-order-facts";
import { afterSalesCommandId, afterSalesText } from "./cancellation-service";

export interface LocationRow {
  id: string;
  label: string;
  address: string;
  phone: string;
  purpose: string;
}

interface RaRow {
  id: string;
  ra_number: string;
  case_id: string;
  order_id: string;
  location_id: string;
  location_snapshot_json: string;
  instructions: string;
  issued_at: string;
  arrival_deadline_date_et: string;
  arrival_deadline_at: string;
  previous_ra_id: string | null;
  review_note: string | null;
  actor_id: string;
}

const hash = (value: string) => piSha256(new TextEncoder().encode(value));
const conflict = () =>
  new Response("Return authorization state changed; reload", { status: 409 });

export function completeReturnLocation(location: LocationRow) {
  const lines = location.address
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    lines.length < 2 ||
    !location.phone.trim() ||
    !location.label.trim() ||
    /PLACEHOLDER|REPLACE[-_ ]?WITH|EXAMPLE\.INVALID|\bTBD\b/i.test(
      `${location.label} ${location.address} ${location.phone}`,
    )
  )
    throw new Response("Return Location details are incomplete", {
      status: 409,
    });
  return {
    label: location.label,
    address: location.address,
    phone: location.phone,
    purpose: location.purpose,
  };
}

export function createReturnAuthorizationService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string | null } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const facts = createD1OrderFacts(db);

  async function rasFor(caseIds: string[]) {
    if (!caseIds.length) return { ras: [] as RaRow[], lines: [] };
    const placeholders = caseIds.map(() => "?").join(",");
    const [ras, lines] = await Promise.all([
      db
        .prepare(
          `SELECT * FROM after_sales_return_authorizations
           WHERE case_id IN (${placeholders}) ORDER BY issued_at,rowid`,
        )
        .bind(...caseIds)
        .all<RaRow>(),
      db
        .prepare(
          `SELECT ra_id,line_id,shipment_id,physical_quantity FROM after_sales_ra_lines
           WHERE case_id IN (${placeholders})`,
        )
        .bind(...caseIds)
        .all<{
          ra_id: string;
          line_id: string;
          shipment_id: string;
          physical_quantity: number;
        }>(),
    ]);
    return { ras: ras.results, lines: lines.results };
  }

  function project(
    rows: Awaited<ReturnType<typeof rasFor>>,
    at: string,
    audience: "customer" | "admin",
  ) {
    return rows.ras.map((row) => ({
      id: row.id,
      raNumber: row.ra_number,
      caseId: row.case_id,
      location: JSON.parse(row.location_snapshot_json) as ReturnType<
        typeof completeReturnLocation
      >,
      instructions: row.instructions,
      issuedAt: row.issued_at,
      arrivalDeadlineDateEt: row.arrival_deadline_date_et,
      arrivalDeadlineAt: row.arrival_deadline_at,
      expired: !isOnOrBefore(at, row.arrival_deadline_at),
      previousRaId: row.previous_ra_id,
      lines: rows.lines
        .filter((line) => line.ra_id === row.id)
        .map((line) => ({
          lineId: line.line_id,
          shipmentId: line.shipment_id,
          physicalQuantity: line.physical_quantity,
        })),
      ...(audience === "admin"
        ? {
            locationId: row.location_id,
            reviewNote: row.review_note,
            actorId: row.actor_id,
          }
        : {}),
    }));
  }

  async function adminCase(orderId: string, caseId: string) {
    const row = await db
      .prepare(
        `SELECT id,case_number,status,version,order_id FROM after_sales_cases
         WHERE id=? AND order_id=?`,
      )
      .bind(caseId, orderId)
      .first<{
        id: string;
        case_number: string;
        status: string;
        version: number;
        order_id: string;
      }>();
    if (!row) throw new Response("Case not found", { status: 404 });
    return row;
  }

  async function caseEvent(input: {
    caseId: string;
    orderId: string;
    actorId: string;
    body: string;
    commandId: string;
    email: string | null;
    timestamp: string;
    guard?: { sql: string; bindings: unknown[] };
  }) {
    const id = `case-event:${input.commandId}`;
    const orderFacts = await facts.read(input.orderId);
    const guard = input.guard ?? { sql: "1=1", bindings: [] };
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO after_sales_case_messages
           (id,case_id,author_role,author_id,visibility,kind,body,created_at,
            command_id,command_hash)
           SELECT ?,?,'admin',?,'customer','event',?,?,?,? WHERE ${guard.sql}`,
        )
        .bind(
          id,
          input.caseId,
          input.actorId,
          input.body,
          input.timestamp,
          id,
          await hash(input.body),
          ...guard.bindings,
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
          orderRequestId: orderFacts.requestId,
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
    return { id, statements, orderFacts };
  }

  return {
    async adminLocations(actor: AdminIdentity) {
      requireAfterSalesPermission(actor, "after_sales.review");
      return (
        await db
          .prepare(
            `SELECT id,label,address,phone,purpose FROM seller_return_locations ORDER BY label`,
          )
          .all<LocationRow>()
      ).results;
    },

    async adminRead(actor: AdminIdentity, orderId: string) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const caseIds = (
        await db
          .prepare(`SELECT id FROM after_sales_cases WHERE order_id=?`)
          .bind(orderId)
          .all<{ id: string }>()
      ).results.map((row) => row.id);
      return project(await rasFor(caseIds), now(), "admin");
    },

    async customerRead(profileId: string, orderId: string) {
      const owned = await facts.ownedOrder(profileId, orderId);
      const caseIds = (
        await db
          .prepare(`SELECT id FROM after_sales_cases WHERE order_id=?`)
          .bind(owned)
          .all<{ id: string }>()
      ).results.map((row) => row.id);
      return project(await rasFor(caseIds), now(), "customer");
    },

    async adminIssue(
      actor: AdminIdentity,
      input: {
        orderId: string;
        caseId: string;
        locationId: string;
        instructions: string;
        lines: Array<{
          lineId: string;
          shipmentId: string;
          physicalQuantity: number;
        }>;
        previousRaId?: string | null;
        reviewNote?: string;
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const commandId = afterSalesCommandId(input.commandId);
      const instructions = afterSalesText(
        input.instructions,
        "Return instructions",
        3000,
      );
      const lines = (Array.isArray(input.lines) ? input.lines : []).filter(
        (line) => line.physicalQuantity > 0,
      );
      if (
        !lines.length ||
        lines.some(
          (line) =>
            !Number.isSafeInteger(line.physicalQuantity) ||
            !line.lineId ||
            !line.shipmentId,
        )
      )
        throw new Response("Authorize at least one claimed quantity", {
          status: 400,
        });
      const commandHash = await hash(
        JSON.stringify({ actor: actor.id, input }),
      );
      const replay = await db
        .prepare(
          `SELECT id,command_hash FROM after_sales_return_authorizations WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; command_hash: string }>();
      if (replay) {
        if (replay.command_hash !== commandHash) throw conflict();
        return replay.id;
      }
      const caseRow = await adminCase(input.orderId, input.caseId);
      if (caseRow.status !== "open") throw conflict();
      const location = await db
        .prepare(
          `SELECT id,label,address,phone,purpose FROM seller_return_locations WHERE id=?`,
        )
        .bind(input.locationId)
        .first<LocationRow>();
      if (!location)
        throw new Response("Choose a maintained Return Location", {
          status: 400,
        });
      const snapshot = completeReturnLocation(location);
      const timestamp = now();
      const prior = (await rasFor([caseRow.id])).ras;
      const expired = prior.filter(
        (ra) => !isOnOrBefore(timestamp, ra.arrival_deadline_at),
      );
      const previousRaId = input.previousRaId || null;
      const reviewNote =
        typeof input.reviewNote === "string" && input.reviewNote.trim()
          ? afterSalesText(input.reviewNote, "Renewed review", 2000)
          : null;
      if (expired.length && (!previousRaId || !reviewNote))
        throw new Response(
          "An earlier RA expired; record the renewed review and link it",
          { status: 400 },
        );
      if (previousRaId && !expired.some((ra) => ra.id === previousRaId))
        throw new Response("Reauthorization must follow an expired RA", {
          status: 400,
        });
      const deadline = raArrivalDeadline(timestamp);
      const id = crypto.randomUUID();
      const raNumber = `RA-${caseRow.case_number}-${prior.length + 1}`;
      const event = await caseEvent({
        caseId: caseRow.id,
        orderId: input.orderId,
        actorId: actor.id,
        body: `Return Authorization ${raNumber} issued for inspection. The return address and packing instructions are shown under Returns and problem reports in your Order. The goods must arrive by 11:59 PM ET on ${etDisplayDate(deadline.dateEt)}. Shipping them before that date is not enough. Inspection comes before any refund decision.`,
        commandId,
        email: `Return Authorization ${raNumber} was issued for Order case ${caseRow.case_number}. Open Returns and problem reports in your Order to see the return address and packing instructions. The goods must arrive by 11:59 PM ET on ${etDisplayDate(deadline.dateEt)}. An RA authorizes return for inspection; it is not a refund approval.`,
        timestamp,
        guard: {
          sql: "EXISTS(SELECT 1 FROM after_sales_return_authorizations WHERE id=?)",
          bindings: [id],
        },
      });
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO after_sales_return_authorizations
             (id,ra_number,case_id,order_id,location_id,location_snapshot_json,
              instructions,issued_at,arrival_deadline_date_et,arrival_deadline_at,
              previous_ra_id,review_note,actor_id,command_id,command_hash)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            raNumber,
            caseRow.id,
            input.orderId,
            location.id,
            JSON.stringify(snapshot),
            instructions,
            timestamp,
            deadline.dateEt,
            deadline.at,
            previousRaId,
            reviewNote,
            actor.id,
            commandId,
            commandHash,
          ),
        ...lines.map((line) =>
          db
            .prepare(
              `INSERT INTO after_sales_ra_lines
               (ra_id,case_id,order_id,line_id,shipment_id,physical_quantity)
               VALUES (?,?,?,?,?,?)`,
            )
            .bind(
              id,
              caseRow.id,
              input.orderId,
              line.lineId,
              line.shipmentId,
              line.physicalQuantity,
            ),
        ),
        ...event.statements,
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES (?,'order.return_authorization_issued','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `return-authorization:${id}`,
            input.orderId,
            actor.id,
            JSON.stringify({
              caseId: caseRow.id,
              raId: id,
              raNumber,
              locationId: location.id,
              lines,
              previousRaId,
              reviewNote,
              arrivalDeadlineAt: deadline.at,
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
            `SELECT id,command_hash FROM after_sales_return_authorizations WHERE command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; command_hash: string }>();
        if (concurrent?.command_hash === commandHash) return concurrent.id;
        const message = error instanceof Error ? error.message : "";
        if (/exceeds|requires|Reauthorization/i.test(message))
          throw new Response(message.replace(/^.*?: /, ""), { status: 409 });
        throw conflict();
      }
      return id;
    },

    async adminDeclineReturn(
      actor: AdminIdentity,
      input: {
        orderId: string;
        caseId: string;
        reason: string;
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const commandId = afterSalesCommandId(input.commandId);
      const reason = afterSalesText(input.reason, "Customer-visible reason");
      const caseRow = await adminCase(input.orderId, input.caseId);
      if (caseRow.status !== "open") throw conflict();
      const timestamp = now();
      const event = await caseEvent({
        caseId: caseRow.id,
        orderId: input.orderId,
        actorId: actor.id,
        body: `Return not authorized. Reason: ${reason} Message us if you disagree or have more information.`,
        commandId,
        email: `An update on case ${caseRow.case_number}: the return was not authorized. Reason: ${reason} Reply to this message if you disagree.`,
        timestamp,
      });
      const replay = await db
        .prepare(`SELECT 1 FROM after_sales_case_messages WHERE id=?`)
        .bind(event.id)
        .first();
      if (replay) return;
      await db.batch([
        ...event.statements,
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES (?,'order.return_declined','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `return-declined:${commandId}`,
            input.orderId,
            actor.id,
            JSON.stringify({ caseId: caseRow.id, reason, commandId }),
            timestamp,
          ),
      ]);
    },

    async adminCloseCase(
      actor: AdminIdentity,
      input: {
        orderId: string;
        caseId: string;
        expectedVersion: number;
        reason: string;
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const commandId = afterSalesCommandId(input.commandId);
      const reason = afterSalesText(input.reason, "Closing summary");
      const caseRow = await adminCase(input.orderId, input.caseId);
      const eventId = `case-event:${commandId}`;
      if (
        await db
          .prepare(`SELECT 1 FROM after_sales_case_messages WHERE id=?`)
          .bind(eventId)
          .first()
      )
        return;
      if (
        caseRow.status !== "open" ||
        caseRow.version !== input.expectedVersion
      )
        throw conflict();
      const timestamp = now();
      const event = await caseEvent({
        caseId: caseRow.id,
        orderId: input.orderId,
        actorId: actor.id,
        body: `Case closed. ${reason}`,
        commandId,
        email: null,
        timestamp,
        guard: {
          sql: "changes()=1",
          bindings: [],
        },
      });
      const results = await db.batch([
        db
          .prepare(
            `UPDATE after_sales_cases SET status='closed',version=version+1,updated_at=?
             WHERE id=? AND version=? AND status='open'`,
          )
          .bind(timestamp, caseRow.id, input.expectedVersion),
        ...event.statements,
      ]);
      if (results[0].meta.changes !== 1) throw conflict();
    },
  };
}

export type ReturnAuthorizationView = Awaited<
  ReturnType<
    ReturnType<typeof createReturnAuthorizationService>["customerRead"]
  >
>[number];
