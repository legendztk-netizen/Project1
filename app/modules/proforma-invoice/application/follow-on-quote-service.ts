import type { AdminIdentity } from "#workers/admin-access";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import { piSha256 } from "../domain/proforma-invoice";
import { quoteNotificationOutboxStatement } from "../../quote-notifications/infrastructure/d1-quote-notifications";

interface DraftRow {
  id: string;
  source_order_id: string;
  profile_id: string;
  purchasing_context_id: string;
  created_at: string;
  created_by_kind: "customer" | "admin";
  submitted_request_id: string | null;
  order_number: string;
}
const digest = (text: string) => piSha256(new TextEncoder().encode(text));
const conflict = () =>
  new Response("Follow-on request changed; reload", { status: 409 });
function checkId(value: string, label: string) {
  if (!value?.trim() || value.length > 150)
    throw new Response(`${label} required`, { status: 400 });
  return value.trim();
}

export function createFollowOnQuoteService(
  db: D1Database,
  options: { now?: () => Date } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const select = `SELECT d.*,o.order_number,
    (SELECT id FROM customer_quote_requests WHERE follow_on_draft_id=d.id) AS submitted_request_id
    FROM follow_on_quote_drafts d JOIN confirmed_orders o ON o.id=d.source_order_id`;
  async function byCommand(commandId: string, commandHash: string) {
    const row = await db
      .prepare(`${select} WHERE d.command_id=?`)
      .bind(commandId)
      .first<DraftRow & { command_hash: string }>();
    if (row && row.command_hash !== commandHash) throw conflict();
    return row;
  }
  return {
    async adminListForOrder(actor: AdminIdentity, orderId: string) {
      if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
        throw new Response("Forbidden", { status: 403 });
      const rows = (
        await db
          .prepare(
            `${select} WHERE o.id=? ORDER BY d.created_at DESC,d.id DESC LIMIT 20`,
          )
          .bind(checkId(orderId, "Order"))
          .all<DraftRow>()
      ).results;
      return rows.map((row) => ({
        id: row.id,
        submittedRequestId: row.submitted_request_id,
        createdAt: row.created_at,
      }));
    },
    async customerRead(profileId: string, draftId: string) {
      checkId(profileId, "Customer");
      const row = await db
        .prepare(
          `${select}
        JOIN customer_quote_requests request ON request.id=o.request_id
        ${ownedQuoteRequestWhere} AND d.id=? AND d.purchasing_context_id=o.purchasing_context_id`,
        )
        .bind(profileId, profileId, profileId, checkId(draftId, "Draft"))
        .first<DraftRow>();
      if (!row)
        throw new Response("Follow-on draft not found", { status: 404 });
      return {
        id: row.id,
        sourceOrderId: row.source_order_id,
        orderNumber: row.order_number,
        purchasingContextId: row.purchasing_context_id,
        submittedRequestId: row.submitted_request_id,
        createdAt: row.created_at,
      };
    },
    async customerListForOrder(profileId: string, orderId: string) {
      checkId(profileId, "Customer");
      const rows = (
        await db
          .prepare(
            `${select}
        JOIN customer_quote_requests request ON request.id=o.request_id
        ${ownedQuoteRequestWhere} AND o.id=? ORDER BY d.created_at DESC,d.id DESC LIMIT 20`,
          )
          .bind(profileId, profileId, profileId, checkId(orderId, "Order"))
          .all<DraftRow>()
      ).results;
      return rows.map((row) => ({
        id: row.id,
        sourceOrderId: row.source_order_id,
        submittedRequestId: row.submitted_request_id,
        createdAt: row.created_at,
      }));
    },
    async customerCreate(
      profileId: string,
      orderId: string,
      commandId: string,
    ) {
      checkId(profileId, "Customer");
      checkId(orderId, "Order");
      checkId(commandId, "Command ID");
      const commandHash = await digest(
        JSON.stringify({ profileId, orderId, commandId }),
      );
      const existing = await byCommand(commandId, commandHash);
      if (existing) return this.customerRead(profileId, existing.id);
      const id = crypto.randomUUID();
      const timestamp = now();
      const result = await db
        .prepare(
          `INSERT INTO follow_on_quote_drafts(id,command_id,command_hash,
        source_order_id,profile_id,purchasing_context_id,created_by_kind,created_by_id,created_at)
        SELECT ?,?,?,o.id,?,o.purchasing_context_id,'customer',?,?
        FROM confirmed_orders o JOIN customer_quote_requests request ON request.id=o.request_id
        ${ownedQuoteRequestWhere} AND o.id=?
        ON CONFLICT(command_id) DO NOTHING`,
        )
        .bind(
          id,
          commandId,
          commandHash,
          profileId,
          profileId,
          timestamp,
          profileId,
          profileId,
          profileId,
          orderId,
        )
        .run();
      if (result.meta.changes !== 1) {
        const replay = await byCommand(commandId, commandHash);
        if (!replay) throw conflict();
        return this.customerRead(profileId, replay.id);
      }
      return this.customerRead(profileId, id);
    },
    async adminCreate(
      actor: AdminIdentity,
      orderId: string,
      commandId: string,
    ) {
      if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
        throw new Response("Forbidden", { status: 403 });
      checkId(orderId, "Order");
      checkId(commandId, "Command ID");
      const commandHash = await digest(
        JSON.stringify({ actorId: actor.id, orderId, commandId }),
      );
      const existing = await byCommand(commandId, commandHash);
      if (existing)
        return { id: existing.id, sourceOrderId: existing.source_order_id };
      const source = await db
        .prepare(
          `SELECT o.request_id,o.order_number,request.profile_id
        FROM confirmed_orders o JOIN customer_quote_requests request ON request.id=o.request_id
        WHERE o.id=?`,
        )
        .bind(orderId)
        .first<{
          request_id: string;
          order_number: string;
          profile_id: string;
        }>();
      if (!source) throw new Response("Order not found", { status: 404 });
      const id = crypto.randomUUID();
      const timestamp = now();
      const messageId = `follow-on-draft:${id}`;
      const body = `A follow-on quote draft for ${source.order_number} is ready in your Orders. Choose current products and submit a new quote request when ready.`;
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO follow_on_quote_drafts(id,command_id,command_hash,source_order_id,
          profile_id,purchasing_context_id,created_by_kind,created_by_id,created_at)
          SELECT ?,?,?,o.id,request.profile_id,o.purchasing_context_id,'admin',?,?
          FROM confirmed_orders o JOIN customer_quote_requests request ON request.id=o.request_id
          WHERE o.id=? ON CONFLICT(command_id) DO NOTHING`,
          )
          .bind(id, commandId, commandHash, actor.id, timestamp, orderId),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'order.follow_on_draft_created','confirmed_order',?,?,?,?
          WHERE EXISTS(SELECT 1 FROM follow_on_quote_drafts WHERE id=?)`,
          )
          .bind(
            `follow-on:${id}`,
            orderId,
            actor.id,
            JSON.stringify({ draftId: id }),
            timestamp,
            id,
          ),
        db
          .prepare(
            `INSERT INTO quote_conversations(request_id,created_at)
          SELECT ?,? WHERE EXISTS(SELECT 1 FROM follow_on_quote_drafts WHERE id=?)
          ON CONFLICT(request_id) DO NOTHING`,
          )
          .bind(source.request_id, timestamp, id),
        db
          .prepare(
            `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,
          created_at,command_id,payload_hash,source,delivery_state)
          SELECT ?,?,'admin',?,?,?, ?,?,'website','available'
          WHERE EXISTS(SELECT 1 FROM follow_on_quote_drafts WHERE id=?)`,
          )
          .bind(
            messageId,
            source.request_id,
            actor.id,
            body,
            timestamp,
            messageId,
            await digest(body),
            id,
          ),
        quoteNotificationOutboxStatement(db, {
          messageId,
          requestId: source.request_id,
          createdAt: timestamp,
        }),
      ]);
      if (results[0].meta.changes !== 1) {
        const replay = await byCommand(commandId, commandHash);
        if (!replay) throw conflict();
        return { id: replay.id, sourceOrderId: replay.source_order_id };
      }
      return { id, sourceOrderId: orderId };
    },
  };
}
