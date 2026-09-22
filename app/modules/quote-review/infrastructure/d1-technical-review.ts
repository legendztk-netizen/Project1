import type { AdminIdentity } from "#workers/admin-access";
import { digest } from "../domain/private-review";
import {
  jsonArray,
  jsonObject,
  jsonPath,
  jsonString,
} from "../domain/admin-quote-review";

export interface TechnicalCompletion {
  actor: string;
  at: string;
  conclusion: string;
  basis: string;
}

interface BasisRow {
  id: string;
  snapshot_json: string;
  version: number | null;
  source_snapshot_json: string | null;
  quoted_lines_json: string | null;
  base_revision_id: string | null;
  revision_id: string | null;
  revision_json: string | null;
  events_json: string;
}
const basisSelect = `SELECT r.id, r.snapshot_json, d.version, d.source_snapshot_json,
 (SELECT json_group_array(json_object('actor',actor_id,'at',occurred_at,'payload',json(payload_json))) FROM admin_audit_events
 WHERE entity_type='quote_technical_review' AND entity_id=r.id AND event_type='quote_technical_review.completed') AS events_json,
 d.quoted_lines_json, d.base_revision_id, q.id AS revision_id, q.snapshot_json AS revision_json
 FROM customer_quote_requests r
 LEFT JOIN quote_preparation_drafts d ON d.request_id=r.id
 LEFT JOIN quote_revisions q ON q.id=(SELECT id FROM quote_revisions WHERE request_id=r.id ORDER BY revision_number DESC LIMIT 1)
 `;

export async function technicalReviewContexts(db: D1Database) {
  const rows = await db.prepare(basisSelect).all<BasisRow>();
  return new Map(
    await Promise.all(
      rows.results.map(
        async (row) =>
          [row.id, await technicalReviewContext(db, row.id, row)] as const,
      ),
    ),
  );
}

export async function technicalReviewContext(
  db: D1Database,
  requestId: string,
  loaded?: BasisRow,
) {
  const row =
    loaded ??
    (await db
      .prepare(`${basisSelect} WHERE r.id=?`)
      .bind(requestId)
      .first<BasisRow>());
  if (!row) throw new Response("Not found", { status: 404 });
  const parse = (text: string | null) => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  };
  const revision = parse(row.revision_json);
  const source = parse(row.source_snapshot_json ?? row.snapshot_json) ?? {};
  const lines = row.quoted_lines_json
    ? JSON.parse(row.quoted_lines_json)
    : source.lines;
  const basis =
    row.version !== null ? `draft:${row.version}` : `rfq:${requestId}`;
  const fingerprint = await digest(
    new TextEncoder().encode(
      JSON.stringify({ requestId, lines, baseRevision: row.base_revision_id }),
    ).buffer,
  );
  const events = JSON.parse(row.events_json) as Array<{
    actor: string;
    at: string;
    payload: { fingerprint: string; conclusion: string; basis: string };
  }>;
  const event = events
    .filter((event) => event.payload.fingerprint === fingerprint)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  let completion: TechnicalCompletion | null = event
    ? {
        actor: event.actor,
        at: event.at,
        conclusion: event.payload.conclusion,
        basis: event.payload.basis,
      }
    : null;
  // A published factory confirmation covers only its exact product configuration,
  // never a newly opened revision draft or a customer's PI acceptance.
  if (
    !completion &&
    revision?.factoryReviewConfirmed === true &&
    row.base_revision_id !== row.revision_id &&
    JSON.stringify(revision.source?.lines) === JSON.stringify(lines) &&
    jsonString(revision.issuedBy) &&
    jsonString(revision.issuedAt)
  ) {
    completion = {
      actor: revision.issuedBy,
      at: revision.issuedAt,
      conclusion: "发布正式报价时已确认与工厂审核未决产品事项。",
      basis: `quote:${revision.revisionNumber}`,
    };
  }
  return {
    fingerprint,
    basis,
    completion,
    snapshot: { ...source, lines },
    version: row.version,
    revisionId: row.revision_id,
    previouslyReviewed: !!revision?.factoryReviewConfirmed || events.length > 0,
  };
}

export async function completeTechnicalReview(
  db: D1Database,
  actor: AdminIdentity,
  requestId: string,
  fingerprint: string,
  conclusion: string,
) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
  conclusion = conclusion.trim();
  if (!conclusion || conclusion.length > 2000)
    throw new Error("请填写审核结论（1–2000 字）。");
  const current = await technicalReviewContext(db, requestId);
  if (current.fingerprint !== fingerprint)
    throw new Error("配置版本已变化，请刷新后重新审核。");
  if (
    !jsonArray(jsonPath(current.snapshot, "lines"))?.length ||
    !jsonObject(current.snapshot)
  )
    throw new Error("商品配置缺失，不能完成技术审核。");
  if (current.completion) return;
  const result = await db
    .prepare(
      `INSERT INTO admin_audit_events
    (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
    SELECT ?,'quote_technical_review.completed','quote_technical_review',?,?,?,?
    WHERE (SELECT version FROM quote_preparation_drafts WHERE request_id=?) IS ?
    AND (SELECT id FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC LIMIT 1) IS ?`,
    )
    .bind(
      crypto.randomUUID(),
      requestId,
      actor.id,
      JSON.stringify({ fingerprint, conclusion, basis: current.basis }),
      new Date().toISOString(),
      requestId,
      current.version,
      requestId,
      current.revisionId,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new Error("配置版本已变化，请刷新后重新审核。");
}
