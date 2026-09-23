import type { AdminIdentity } from "#workers/admin-access";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import {
  piSha256,
  type ProformaInvoiceSnapshot,
} from "../domain/proforma-invoice";

interface OrderRow {
  id: string;
  order_number: string;
  request_id: string;
  pi_id: string;
  snapshot_json: string;
  snapshot_hash: string;
  currency: "USD";
  total_cents: number;
  confirmed_at: string;
  held: number;
  shipment_count?: number;
  plan_status?: "ready" | "review" | null;
}

export interface AdminOrderFilters {
  query: string;
  status: "all" | "confirmed" | "hold";
  from: string;
  to: string;
  country: string;
  productType: "all" | "standard" | "assembly" | "hose";
  sort: "newest" | "oldest" | "amount_desc" | "amount_asc";
  page: number;
}

interface AdminOrderSummaryRow {
  id: string;
  order_number: string;
  request_id: string;
  reference_number: string;
  pi_id: string;
  document_number: string | null;
  customer_email: string;
  customer_name: string | null;
  total_cents: number;
  confirmed_at: string;
  country_code: string | null;
  held: number;
  line_count: number;
  shipment_count: number;
  plan_status: "ready" | "review" | null;
  first_line_json: string | null;
  second_line_json: string | null;
}

function assertAdmin(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}

function summaryLine(value: string | null) {
  if (!value) return null;
  const line = JSON.parse(value) as ProformaInvoiceSnapshot["lines"][number];
  return {
    displayName: line.displayName,
    sku: line.sku,
    imageUrl: line.assembly ? null : line.product.mainImageUrl,
    hoseMediaKey:
      line.assembly?.hose.mediaKey ??
      (line.lineKind === "length_based_hose" ? line.product.mediaKey : null),
  };
}

async function projection(row: OrderRow) {
  if (
    (await piSha256(new TextEncoder().encode(row.snapshot_json))) !==
    row.snapshot_hash
  )
    throw new Response("Order snapshot integrity failure", { status: 409 });
  const snapshot = JSON.parse(row.snapshot_json) as ProformaInvoiceSnapshot;
  return {
    id: row.id,
    orderNumber: row.order_number,
    requestId: row.request_id,
    piId: row.pi_id,
    confirmedAt: row.confirmed_at,
    currency: row.currency,
    totalCents: row.total_cents,
    status:
      row.held === 1
        ? ("Payment Review Hold" as const)
        : ("Order Confirmed" as const),
    shipmentCount: row.shipment_count ?? 0,
    shipmentPlanStatus: row.plan_status ?? null,
    snapshot,
  };
}

export function createConfirmedOrderService(db: D1Database) {
  const owned = `FROM confirmed_orders o
    LEFT JOIN order_release_guards guard ON guard.order_id=o.id
    JOIN customer_quote_requests request ON request.id=o.request_id
    ${ownedQuoteRequestWhere}`;
  function bindings(profileId: string) {
    return [profileId, profileId, profileId];
  }
  return {
    async adminList(actor: AdminIdentity, filters: AdminOrderFilters) {
      assertAdmin(actor);
      if (filters.query.length > 150 || filters.country.length > 3)
        throw new Response("Invalid order filters", { status: 400 });
      const page = Number.isSafeInteger(filters.page)
        ? Math.max(1, Math.min(filters.page, 10000))
        : 1;
      const conditions = ["1=1"];
      const values: unknown[] = [];
      if (filters.query) {
        conditions.push(`(
          instr(lower(o.id),?)>0 OR instr(lower(o.order_number),?)>0
          OR instr(lower(o.pi_id),?)>0 OR instr(lower(pi.document_number),?)>0
          OR instr(lower(request.reference_number),?)>0
          OR instr(lower(profile.email_normalized),?)>0
          OR instr(lower(coalesce(json_extract(o.snapshot_json,'$.buyer.legalName'),'')),?)>0
          OR instr(lower(coalesce(json_extract(o.snapshot_json,'$.buyer.tradeName'),'')),?)>0
          OR instr(lower(coalesce(json_extract(o.snapshot_json,'$.buyer.contactName'),'')),?)>0
        )`);
        values.push(...Array(9).fill(filters.query.toLowerCase()));
      }
      if (filters.from) {
        conditions.push("date(o.confirmed_at,'+8 hours')>=?");
        values.push(filters.from);
      }
      if (filters.to) {
        conditions.push("date(o.confirmed_at,'+8 hours')<=?");
        values.push(filters.to);
      }
      if (filters.country) {
        conditions.push(
          "json_extract(o.snapshot_json,'$.destination.countryCode')=?",
        );
        values.push(filters.country);
      }
      if (filters.productType !== "all") {
        const kinds = {
          standard: "standard",
          assembly: "configured_assembly",
          hose: "length_based_hose",
        };
        conditions.push(`EXISTS(SELECT 1 FROM confirmed_order_lines line
          WHERE line.order_id=o.id AND line.line_kind=?)`);
        values.push(kinds[filters.productType]);
      }
      const from = `FROM confirmed_orders o
        LEFT JOIN order_release_guards guard ON guard.order_id=o.id
        JOIN customer_quote_requests request ON request.id=o.request_id
        JOIN customer_profiles profile ON profile.id=request.profile_id
        JOIN proforma_invoices pi ON pi.id=o.pi_id`;
      const where = `WHERE ${conditions.join(" AND ")}`;
      const counts = await db
        .prepare(
          `SELECT count(*) AS total,
          sum(CASE WHEN coalesce(guard.held,0)=0 THEN 1 ELSE 0 END) AS confirmed,
          sum(CASE WHEN guard.held=1 THEN 1 ELSE 0 END) AS held
          ${from} ${where}`,
        )
        .bind(...values)
        .first<{
          total: number;
          confirmed: number | null;
          held: number | null;
        }>();
      const total = counts?.total ?? 0;
      const statusWhere =
        filters.status === "hold"
          ? "AND guard.held=1"
          : filters.status === "confirmed"
            ? "AND coalesce(guard.held,0)=0"
            : "";
      const statusTotal =
        filters.status === "hold"
          ? (counts?.held ?? 0)
          : filters.status === "confirmed"
            ? (counts?.confirmed ?? 0)
            : total;
      const effectiveStatusPage = Math.min(
        page,
        Math.max(1, Math.ceil(statusTotal / 25)),
      );
      const orderBy = {
        newest: "o.confirmed_at DESC,o.id DESC",
        oldest: "o.confirmed_at ASC,o.id ASC",
        amount_desc: "o.total_cents DESC,o.id DESC",
        amount_asc: "o.total_cents ASC,o.id ASC",
      }[filters.sort];
      const rows = (
        await db
          .prepare(
            `SELECT o.id,o.order_number,o.request_id,request.reference_number,
          o.pi_id,pi.document_number,profile.email_display AS customer_email,
          coalesce(nullif(json_extract(o.snapshot_json,'$.buyer.legalName'),''),
            nullif(json_extract(o.snapshot_json,'$.buyer.tradeName'),''),
            nullif(json_extract(o.snapshot_json,'$.buyer.contactName'),'')) AS customer_name,
          o.total_cents,o.confirmed_at,
          json_extract(o.snapshot_json,'$.destination.countryCode') AS country_code,
          coalesce(guard.held,0) AS held,
          (SELECT count(*) FROM confirmed_order_lines line WHERE line.order_id=o.id) AS line_count,
          (SELECT count(*) FROM order_shipments shipment WHERE shipment.order_id=o.id) AS shipment_count,
          (SELECT status FROM order_fulfillment_plans plan WHERE plan.order_id=o.id) AS plan_status,
          (SELECT snapshot_json FROM confirmed_order_lines line WHERE line.order_id=o.id
            ORDER BY line.line_number LIMIT 1) AS first_line_json,
          (SELECT snapshot_json FROM confirmed_order_lines line WHERE line.order_id=o.id
            ORDER BY line.line_number LIMIT 1 OFFSET 1) AS second_line_json
          ${from} ${where} ${statusWhere}
          ORDER BY ${orderBy} LIMIT 25 OFFSET ?`,
          )
          .bind(...values, (effectiveStatusPage - 1) * 25)
          .all<AdminOrderSummaryRow>()
      ).results;
      const countries = (
        await db
          .prepare(
            `SELECT DISTINCT json_extract(snapshot_json,'$.destination.countryCode') AS code
          FROM confirmed_orders WHERE json_extract(snapshot_json,'$.destination.countryCode') IS NOT NULL
          AND json_extract(snapshot_json,'$.destination.countryCode')!='' ORDER BY code`,
          )
          .all<{ code: string }>()
      ).results.map((row) => row.code);
      return {
        records: rows.map((row) => ({
          id: row.id,
          orderNumber: row.order_number,
          requestId: row.request_id,
          referenceNumber: row.reference_number,
          piId: row.pi_id,
          documentNumber: row.document_number,
          customerName: row.customer_name || row.customer_email,
          customerEmail: row.customer_email,
          totalCents: row.total_cents,
          confirmedAt: row.confirmed_at,
          countryCode: row.country_code,
          status: row.held ? "Payment Review Hold" : "Order Confirmed",
          lineCount: row.line_count,
          shipmentCount: row.shipment_count,
          shipmentPlanStatus: row.plan_status,
          lines: [
            summaryLine(row.first_line_json),
            summaryLine(row.second_line_json),
          ].filter((line) => line !== null),
        })),
        counts: {
          all: total,
          confirmed: counts?.confirmed ?? 0,
          hold: counts?.held ?? 0,
        },
        countries,
        page: effectiveStatusPage,
        pageCount: Math.max(1, Math.ceil(statusTotal / 25)),
      };
    },
    async adminActivity(actor: AdminIdentity, orderId: string) {
      assertAdmin(actor);
      const context = await db
        .prepare(
          `SELECT
        acceptance.accepted_at AS accepted_at,
        confirmation.confirmed_at AS payment_confirmed_at,
        confirmation.confirmed_cents AS payment_confirmed_cents,
        confirmation.actual_channel AS payment_channel,
        account.due_at AS payment_due_at
        FROM confirmed_orders o
        JOIN pi_acceptances acceptance ON acceptance.id=o.acceptance_id
        JOIN pi_payment_confirmations confirmation ON confirmation.id=o.confirmation_id
        LEFT JOIN pi_payment_accounts account ON account.pi_id=o.pi_id
        WHERE o.id=?`,
        )
        .bind(orderId)
        .first<{
          accepted_at: string;
          payment_confirmed_at: string;
          payment_confirmed_cents: number;
          payment_channel: string;
          payment_due_at: string | null;
        }>();
      if (!context) throw new Response("Order not found", { status: 404 });
      const events = (
        await db
          .prepare(
            `SELECT event_type,occurred_at
        FROM admin_audit_events WHERE entity_type='confirmed_order' AND entity_id=?
        ORDER BY occurred_at DESC,id DESC LIMIT 50`,
          )
          .bind(orderId)
          .all<{ event_type: string; occurred_at: string }>()
      ).results;
      const holds = (
        await db
          .prepare(
            `SELECT kind,occurred_at FROM pi_order_hold_events
        WHERE order_id=? ORDER BY occurred_at DESC,id DESC LIMIT 50`,
          )
          .bind(orderId)
          .all<{ kind: "hold" | "release"; occurred_at: string }>()
      ).results;
      return {
        acceptedAt: context.accepted_at,
        paymentConfirmedAt: context.payment_confirmed_at,
        paymentConfirmedCents: context.payment_confirmed_cents,
        paymentChannel: context.payment_channel,
        paymentDueAt: context.payment_due_at,
        events: [
          ...events.map((event) => ({
            type: event.event_type,
            occurredAt: event.occurred_at,
          })),
          ...holds.map((event) => ({
            type: `order.${event.kind}`,
            occurredAt: event.occurred_at,
          })),
        ]
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .slice(0, 50),
      };
    },
    async customerList(profileId: string, before: string | null = null) {
      if (!profileId) throw new Response("Forbidden", { status: 403 });
      if (before && before.length > 150)
        throw new Response("Invalid cursor", { status: 400 });
      const rows = (
        await db
          .prepare(
            `SELECT o.*,guard.held,
              (SELECT count(*) FROM order_shipments shipment WHERE shipment.order_id=o.id) AS shipment_count,
              (SELECT status FROM order_fulfillment_plans plan WHERE plan.order_id=o.id) AS plan_status
              ${owned} AND (? IS NULL OR
          (o.confirmed_at < (SELECT confirmed_at FROM confirmed_orders WHERE id=?) OR
           (o.confirmed_at=(SELECT confirmed_at FROM confirmed_orders WHERE id=?) AND o.id<?)))
         ORDER BY o.confirmed_at DESC,o.id DESC LIMIT 11`,
          )
          .bind(...bindings(profileId), before, before, before, before)
          .all<OrderRow>()
      ).results;
      const page = rows.slice(0, 10);
      return {
        records: await Promise.all(page.map(projection)),
        nextCursor: rows.length > 10 ? page[9].id : null,
      };
    },
    async customerRead(profileId: string, orderId: string) {
      if (!profileId) throw new Response("Forbidden", { status: 403 });
      const row = await db
        .prepare(`SELECT o.*,guard.held ${owned} AND o.id=?`)
        .bind(...bindings(profileId), orderId)
        .first<OrderRow>();
      if (!row) throw new Response("Order not found", { status: 404 });
      return projection(row);
    },
    async adminSearch(actor: AdminIdentity, search: string) {
      if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
        throw new Response("Forbidden", { status: 403 });
      const query = search.trim();
      if (!query || query.length > 150)
        throw new Response("Search term required", { status: 400 });
      const rows = (
        await db
          .prepare(
            `SELECT o.*,guard.held FROM confirmed_orders o
         LEFT JOIN order_release_guards guard ON guard.order_id=o.id
         JOIN customer_quote_requests q ON q.id=o.request_id
         JOIN customer_profiles p ON p.id=q.profile_id
         WHERE o.id=? OR o.order_number=? OR o.pi_id=? OR p.email_normalized=?
         ORDER BY o.confirmed_at DESC,o.id DESC LIMIT 21`,
          )
          .bind(query, query, query, query.toLowerCase())
          .all<OrderRow>()
      ).results;
      return Promise.all(rows.map(projection));
    },
    async adminRead(actor: AdminIdentity, orderId: string) {
      if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
        throw new Response("Forbidden", { status: 403 });
      const row = await db
        .prepare(
          `SELECT o.*,guard.held FROM confirmed_orders o
        LEFT JOIN order_release_guards guard ON guard.order_id=o.id WHERE o.id=?`,
        )
        .bind(orderId)
        .first<OrderRow>();
      if (!row) throw new Response("Order not found", { status: 404 });
      return projection(row);
    },
  };
}
