import type { AdminIdentity } from "#workers/admin-access";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { digest } from "../domain/private-review";
import {
  reviseQuoteLine,
  type QuoteLineEdit,
  type ReviewedQuoteLine,
} from "../domain/quote-line-revision";
import { createQuotePreparation } from "./d1-quote-preparation";
import { prepareQuoteAssemblyAmendment } from "./prepare-quote-assembly-amendment";

export async function saveQuoteLineRevisions(
  db: D1Database,
  actor: AdminIdentity,
  input: {
    requestId: string;
    version: number;
    edits: QuoteLineEdit[];
    reason: string;
    commandId: string;
  },
) {
  const preparation = createQuotePreparation(db, actor);
  if (
    !/^[0-9a-f-]{36}$/.test(input.commandId) ||
    !input.reason.trim() ||
    input.reason.length > 2000
  )
    throw new Response("Reason and command required", { status: 400 });
  if (
    !Array.isArray(input.edits) ||
    input.edits.length < 1 ||
    input.edits.length > 100 ||
    new Set(input.edits.map((edit) => edit.id)).size !== input.edits.length
  )
    throw new Error("One to 100 unique product lines required");
  const edits = input.edits.map((edit) => ({
    id: edit.id,
    sku: edit.sku.trim(),
    quantity: edit.quantity,
    lengthValue: edit.lengthValue.trim(),
    lengthUnit: edit.lengthUnit,
    specifications: edit.specifications
      .map((spec) => ({ label: spec.label.trim(), value: spec.value.trim() }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    ...(edit.assembly
      ? {
          assembly: {
            confirmCurrentComponentRefresh:
              edit.assembly.confirmCurrentComponentRefresh === true,
            endASku: edit.assembly.endASku.trim(),
            endAFerruleSku: edit.assembly.endAFerruleSku.trim(),
            endBSku: edit.assembly.endBSku.trim(),
            endBFerruleSku: edit.assembly.endBFerruleSku.trim(),
            measurement: edit.assembly.measurement.trim(),
            clocking: edit.assembly.clocking.trim(),
            protectionCode: edit.assembly.protectionCode.trim(),
          },
        }
      : {}),
  }));
  const payloadHash = await digest(
    new TextEncoder().encode(
      JSON.stringify({
        intent: "quoted-lines",
        requestId: input.requestId,
        version: input.version,
        edits,
        reason: input.reason.trim(),
      }),
    ).buffer,
  );
  async function replay() {
    const row = await db
      .prepare(
        "SELECT actor_id,payload_hash,resulting_version FROM quote_pricing_commands WHERE id=?",
      )
      .bind(input.commandId)
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
  const draft = await preparation.find(input.requestId);
  if (!draft) throw new Response("Not found", { status: 404 });
  if (!draft.baseRevisionId || draft.version !== input.version)
    throw new Response(
      "Start the current quote's revision draft before editing products",
      { status: 409 },
    );
  const latest = await db
    .prepare(
      "SELECT id FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC LIMIT 1",
    )
    .bind(input.requestId)
    .first<{ id: string }>();
  if (latest?.id !== draft.baseRevisionId)
    throw new Response("Current quote changed", { status: 409 });
  const catalog = createD1PublicCatalogRepository(db);
  const lines: ReviewedQuoteLine[] = [];
  const prices = [];
  for (const edit of edits) {
    const index = draft.source.lines.findIndex((line) => line.id === edit.id);
    const existing = draft.source.lines[index] ?? null;
    const changedProduct = !existing || existing.sku !== edit.sku;
    if (
      changedProduct &&
      existing?.lineKind === "configured_assembly" &&
      !edit.assembly
    )
      throw new Error(
        "Assembly hose replacement requires component revalidation",
      );
    const replacement = changedProduct
      ? await catalog.findItem(edit.sku)
      : null;
    const revised = reviseQuoteLine(existing, edit, replacement);
    const amended = existing
      ? await prepareQuoteAssemblyAmendment(db, existing, revised, edit)
      : { line: revised, changed: false };
    lines.push(amended.line);
    prices.push(
      changedProduct || amended.changed
        ? { unitPriceCents: null, discountBasisPoints: 0 }
        : draft.prices[index],
    );
  }
  const terms = draft.terms
    ? {
        ...draft.terms,
        freightReviewConfirmed: false,
        manualCurrencyConfirmed: false,
        leadTime: "",
      }
    : null;
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          "UPDATE quote_preparation_drafts SET quoted_lines_json=?,prices_json=?,terms_json=?,version=version+1,updated_by=?,updated_at=? WHERE request_id=? AND version=? AND base_revision_id=(SELECT id FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC LIMIT 1)",
        )
        .bind(
          JSON.stringify(lines),
          JSON.stringify(prices),
          terms ? JSON.stringify(terms) : null,
          actor.id,
          now,
          input.requestId,
          input.version,
          input.requestId,
        ),
      db
        .prepare(
          "INSERT INTO quote_pricing_commands(id,request_id,actor_id,payload_hash,resulting_version) SELECT ?,?,?,?,? WHERE changes()=1",
        )
        .bind(
          input.commandId,
          input.requestId,
          actor.id,
          payloadHash,
          input.version + 1,
        ),
      db
        .prepare(
          "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) SELECT ?,'quote_revision.products_changed','quote_preparation',?,?,?,? WHERE EXISTS(SELECT 1 FROM quote_pricing_commands WHERE id=?)",
        )
        .bind(
          `quote-lines:${input.commandId}`,
          input.requestId,
          actor.id,
          JSON.stringify({
            former: draft.source.lines,
            current: lines,
            reason: input.reason.trim(),
            version: input.version + 1,
          }),
          now,
          input.commandId,
        ),
    ]);
  } catch (error) {
    const done = await replay();
    if (done) return done;
    throw error;
  }
  const done = await replay();
  if (!done) throw new Response("Preparation changed", { status: 409 });
  return done;
}
