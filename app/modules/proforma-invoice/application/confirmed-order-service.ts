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
    async customerList(profileId: string, before: string | null = null) {
      if (!profileId) throw new Response("Forbidden", { status: 403 });
      if (before && before.length > 150)
        throw new Response("Invalid cursor", { status: 400 });
      const rows = (
        await db
          .prepare(
            `SELECT o.*,guard.held ${owned} AND (? IS NULL OR
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
