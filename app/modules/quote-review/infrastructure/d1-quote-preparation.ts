import type { AdminIdentity } from "#workers/admin-access";
import type { QuoteRequestSnapshot } from "../../quote-request/domain/quote-request";
import { digest } from "../domain/private-review";
import {
  initialQuotePrices,
  quoteLineTotals,
  type QuotedLinePrice,
} from "../domain/quote-pricing";

interface DraftRow {
  request_id: string;
  source_hash: string;
  source_snapshot_json: string;
  prices_json: string;
  version: number;
}
const hash = (value: string) => digest(new TextEncoder().encode(value).buffer);

export function createQuotePreparation(db: D1Database, actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
  async function find(requestId: string) {
    const row = await db
      .prepare("SELECT * FROM quote_preparation_drafts WHERE request_id=?")
      .bind(requestId)
      .first<DraftRow>();
    return row
      ? {
          requestId: row.request_id,
          sourceHash: row.source_hash,
          source: JSON.parse(row.source_snapshot_json) as QuoteRequestSnapshot,
          prices: JSON.parse(row.prices_json) as QuotedLinePrice[],
          version: row.version,
        }
      : null;
  }
  return {
    find,
    async start(requestId: string) {
      const existing = await find(requestId);
      if (existing) return existing;
      const rfq = await db
        .prepare("SELECT snapshot_json FROM customer_quote_requests WHERE id=?")
        .bind(requestId)
        .first<{ snapshot_json: string }>();
      if (!rfq) throw new Response("Not found", { status: 404 });
      const source = JSON.parse(rfq.snapshot_json) as QuoteRequestSnapshot;
      const prices = initialQuotePrices(source.lines);
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            "INSERT INTO quote_preparation_drafts(request_id,source_hash,source_snapshot_json,prices_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING",
          )
          .bind(
            requestId,
            await hash(rfq.snapshot_json),
            rfq.snapshot_json,
            JSON.stringify(prices),
            actor.id,
            now,
            actor.id,
            now,
          ),
        db
          .prepare(
            "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) SELECT ?,'quote_preparation.started','quote_preparation',?,?,'{}',? WHERE changes()=1",
          )
          .bind(`quote-start:${requestId}`, requestId, actor.id, now),
      ]);
      return (await find(requestId))!;
    },
    async savePrices(
      requestId: string,
      version: number,
      prices: QuotedLinePrice[],
      reason: string,
      commandId: string,
    ) {
      if (
        !Array.isArray(prices) ||
        prices.some((price) => !price || typeof price !== "object")
      )
        throw new Response("Invalid prices", { status: 400 });
      prices = prices.map((price) => ({
        unitPriceCents: price.unitPriceCents,
        discountBasisPoints: price.discountBasisPoints,
      }));
      if (
        !/^[0-9a-f-]{36}$/.test(commandId) ||
        !reason.trim() ||
        reason.length > 2000
      )
        throw new Response("Reason and command required", { status: 400 });
      const payloadHash = await hash(
        JSON.stringify({ requestId, version, prices, reason }),
      );
      async function replay() {
        const row = await db
          .prepare(
            "SELECT actor_id,payload_hash,resulting_version FROM quote_pricing_commands WHERE id=?",
          )
          .bind(commandId)
          .first<{
            actor_id: string;
            payload_hash: string;
            resulting_version: number;
          }>();
        if (!row) return null;
        if (row.actor_id !== actor.id || row.payload_hash !== payloadHash)
          throw new Response("Command conflict", { status: 409 });
        return row.resulting_version;
      }
      const prior = await replay();
      if (prior) return prior;
      const draft = await find(requestId);
      if (!draft) throw new Response("Not found", { status: 404 });
      if (draft.version !== version)
        throw new Response("Draft changed; reload before saving", {
          status: 409,
        });
      if (prices.length !== draft.source.lines.length)
        throw new Response("Line count mismatch", { status: 400 });
      prices.forEach((price, index) =>
        quoteLineTotals(draft.source.lines[index], price),
      );
      const now = new Date().toISOString();
      try {
        await db.batch([
          db
            .prepare(
              "UPDATE quote_preparation_drafts SET prices_json=?,version=version+1,updated_by=?,updated_at=? WHERE request_id=? AND version=?",
            )
            .bind(JSON.stringify(prices), actor.id, now, requestId, version),
          db
            .prepare(
              "INSERT INTO quote_pricing_commands(id,request_id,actor_id,payload_hash,resulting_version) SELECT ?,?,?,?,? WHERE changes()=1",
            )
            .bind(commandId, requestId, actor.id, payloadHash, version + 1),
          db
            .prepare(
              "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) SELECT ?,'quote_pricing.changed','quote_preparation',?,?,?,? WHERE EXISTS(SELECT 1 FROM quote_pricing_commands WHERE id=?)",
            )
            .bind(
              `quote-pricing:${commandId}`,
              requestId,
              actor.id,
              JSON.stringify({
                currency: "USD",
                former: draft.prices,
                current: prices,
                reason,
                sourceVersion: version,
                version: version + 1,
              }),
              now,
              commandId,
            ),
        ]);
      } catch (error) {
        const completed = await replay();
        if (completed) return completed;
        throw error;
      }
      const completed = await replay();
      if (!completed)
        throw new Response("Draft changed; reload before saving", {
          status: 409,
        });
      return completed;
    },
  };
}
