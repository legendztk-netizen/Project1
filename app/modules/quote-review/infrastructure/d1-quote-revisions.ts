import type { AdminIdentity } from "#workers/admin-access";
import { createD1QuoteRequestRepository } from "../../quote-request/infrastructure/d1-quote-request-repository";
import { digest } from "../domain/private-review";
import {
  customerRevisionProjection,
  validateQuoteIssuance,
  type QuoteRevisionSnapshot,
} from "../domain/quote-revision";
import { createQuotePreparation } from "./d1-quote-preparation";
import { quoteRevisionDifferences } from "../domain/quote-revision-differences";

interface RevisionRow {
  id: string;
  snapshot_json: string;
  snapshot_hash: string;
  command_hash: string;
  issued_by: string;
}
const hash = (text: string) => digest(new TextEncoder().encode(text).buffer);
function record(row: RevisionRow) {
  return {
    id: row.id,
    hash: row.snapshot_hash,
    snapshot: JSON.parse(row.snapshot_json) as QuoteRevisionSnapshot,
  };
}
export function createQuoteRevisions(db: D1Database) {
  async function current(requestId: string) {
    const row = await db
      .prepare(
        "SELECT * FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC LIMIT 1",
      )
      .bind(requestId)
      .first<RevisionRow>();
    return row ? record(row) : null;
  }
  return {
    current,
    async startNext(
      actor: AdminIdentity,
      requestId: string,
      expectedRevisionId: string,
      expectedVersion: number,
    ) {
      const preparation = createQuotePreparation(db, actor);
      const base = await current(requestId);
      const draft = await preparation.find(requestId);
      if (!base || !draft)
        throw new Response("Quote not found", { status: 404 });
      if (base.id !== expectedRevisionId)
        throw new Response("Current quote changed", { status: 409 });
      if (draft.baseRevisionId === base.id) return draft;
      if (
        draft.version !== expectedVersion ||
        draft.version !== base.snapshot.preparationVersion
      )
        throw new Response(
          "Preparation changed; do not overwrite pending edits",
          { status: 409 },
        );
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            "UPDATE quote_preparation_drafts SET base_revision_id=?,quoted_lines_json=?,prices_json=?,terms_json=?,version=version+1,updated_by=?,updated_at=? WHERE request_id=? AND version=? AND (SELECT id FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC LIMIT 1)=?",
          )
          .bind(
            base.id,
            JSON.stringify(base.snapshot.source.lines),
            JSON.stringify(base.snapshot.prices),
            JSON.stringify(base.snapshot.terms),
            actor.id,
            now,
            requestId,
            draft.version,
            requestId,
            base.id,
          ),
        db
          .prepare(
            "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) SELECT ?,'quote_revision.preparation_started','quote_preparation',?,?,?,? WHERE changes()=1",
          )
          .bind(
            `quote-next:${base.id}`,
            requestId,
            actor.id,
            JSON.stringify({
              baseRevisionId: base.id,
              version: draft.version + 1,
            }),
            now,
          ),
      ]);
      const result = (await preparation.find(requestId))!;
      if (result.baseRevisionId !== base.id)
        throw new Response("Preparation changed", { status: 409 });
      return result;
    },
    async history(requestId: string) {
      const rows = await db
        .prepare(
          "SELECT * FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC",
        )
        .bind(requestId)
        .all<RevisionRow>();
      return rows.results.map(record);
    },
    async customerHistory(profileId: string, requestId: string) {
      if (
        !(await createD1QuoteRequestRepository(db).findOwned(
          profileId,
          requestId,
        ))
      )
        return [];
      const rows = await db
        .prepare(
          "SELECT * FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC",
        )
        .bind(requestId)
        .all<RevisionRow>();
      return rows.results.map((row) => ({
        id: row.id,
        ...customerRevisionProjection(record(row).snapshot),
      }));
    },
    async customerProposedChanges(
      profileId: string,
      requestId: string,
      baseRevisionId: string,
    ) {
      if (
        !(await createD1QuoteRequestRepository(db).findOwned(
          profileId,
          requestId,
        ))
      )
        return [];
      const row = await db
        .prepare(
          "SELECT draft.source_snapshot_json,draft.quoted_lines_json,draft.prices_json,draft.terms_json,revision.snapshot_json FROM quote_preparation_drafts draft INNER JOIN quote_revisions revision ON revision.id=draft.base_revision_id WHERE draft.request_id=? AND draft.base_revision_id=? AND draft.version > revision.preparation_version AND revision.id=(SELECT id FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC LIMIT 1)",
        )
        .bind(requestId, baseRevisionId, requestId)
        .first<{
          source_snapshot_json: string;
          quoted_lines_json: string | null;
          prices_json: string;
          terms_json: string | null;
          snapshot_json: string;
        }>();
      if (!row?.terms_json) return [];
      const source = JSON.parse(row.source_snapshot_json);
      if (row.quoted_lines_json)
        source.lines = JSON.parse(row.quoted_lines_json);
      return quoteRevisionDifferences(JSON.parse(row.snapshot_json), {
        source,
        prices: JSON.parse(row.prices_json),
        terms: JSON.parse(row.terms_json),
      });
    },
    async customerCurrent(profileId: string, requestId: string) {
      if (
        !(await createD1QuoteRequestRepository(db).findOwned(
          profileId,
          requestId,
        ))
      )
        return null;
      const revision = await current(requestId);
      return revision
        ? {
            id: revision.id,
            hash: revision.hash,
            ...customerRevisionProjection(revision.snapshot),
          }
        : null;
    },
    async issueRevision(
      actor: AdminIdentity,
      input: {
        requestId: string;
        preparationVersion: number;
        sourceHash: string;
        factoryReviewConfirmed: boolean;
        commandId: string;
        baseRevisionId?: string | null;
        changeReason?: string;
      },
    ) {
      const preparation = createQuotePreparation(db, actor);
      if (
        !/^[0-9a-f-]{36}$/.test(input.commandId) ||
        !Number.isSafeInteger(input.preparationVersion)
      )
        throw new Response("Invalid issuance command", { status: 400 });
      const commandHash = await hash(
        JSON.stringify({
          requestId: input.requestId,
          preparationVersion: input.preparationVersion,
          sourceHash: input.sourceHash,
          factoryReviewConfirmed: input.factoryReviewConfirmed === true,
          ...(input.baseRevisionId
            ? {
                baseRevisionId: input.baseRevisionId,
                changeReason: input.changeReason?.trim() ?? "",
              }
            : {}),
        }),
      );
      async function replay() {
        const row = await db
          .prepare("SELECT * FROM quote_revisions WHERE command_id=?")
          .bind(input.commandId)
          .first<RevisionRow>();
        if (!row) return null;
        if (row.issued_by !== actor.id || row.command_hash !== commandHash)
          throw new Response("Command conflict", { status: 409 });
        return record(row);
      }
      const prior = await replay();
      if (prior) return prior;
      const draft = await preparation.find(input.requestId);
      if (!draft) throw new Response("Not found", { status: 404 });
      const previous = await current(input.requestId);
      if (
        draft.version !== input.preparationVersion ||
        draft.sourceHash !== input.sourceHash ||
        (previous?.id ?? null) !== (input.baseRevisionId ?? null) ||
        draft.baseRevisionId !== (input.baseRevisionId ?? null)
      )
        throw new Response("Quote changed; reload before issuing", {
          status: 409,
        });
      const { terms, totals } = validateQuoteIssuance(
        draft,
        input.factoryReviewConfirmed === true,
      );
      if (
        terms.taxEvidenceId &&
        !(await db
          .prepare(
            "SELECT id FROM quote_private_evidence WHERE id=? AND request_id=? AND kind='tax_exemption' AND visibility='internal'",
          )
          .bind(terms.taxEvidenceId, input.requestId)
          .first())
      )
        throw new Response("Missing private tax evidence", { status: 400 });
      const source = await db
        .prepare("SELECT snapshot_json FROM customer_quote_requests WHERE id=?")
        .bind(input.requestId)
        .first<{ snapshot_json: string }>();
      if (!source || (await hash(source.snapshot_json)) !== input.sourceHash)
        throw new Response("RFQ source changed", { status: 409 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const differences = previous
        ? quoteRevisionDifferences(previous.snapshot, {
            source: draft.source,
            prices: draft.prices,
            terms,
          })
        : [];
      if (
        previous &&
        (!input.changeReason?.trim() || input.changeReason.length > 2000)
      )
        throw new Error(
          "A revision reason is required (maximum 2000 characters)",
        );
      if (previous && !differences.length)
        throw new Error("No material changes to issue");
      const revisionNumber = (previous?.snapshot.revisionNumber ?? 0) + 1;
      const snapshot: QuoteRevisionSnapshot = {
        version: 1,
        requestId: input.requestId,
        revisionNumber,
        sourceHash: input.sourceHash,
        source: draft.source,
        originalRfqSource: draft.originalSource,
        previousRevisionId: previous?.id ?? null,
        changeReason: previous ? input.changeReason!.trim() : "",
        differences,
        preparationVersion: draft.version,
        prices: draft.prices,
        terms,
        totals,
        issuedAt: now,
        issuedBy: actor.id,
        factoryReviewConfirmed: input.factoryReviewConfirmed === true,
      };
      const json = JSON.stringify(snapshot);
      try {
        await db.batch([
          db
            .prepare(
              "INSERT INTO quote_revisions(id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at) SELECT ?,request_id,?,version,?,?,?,?,?,? FROM quote_preparation_drafts WHERE request_id=? AND version=? AND source_hash=? AND source_snapshot_json=(SELECT snapshot_json FROM customer_quote_requests WHERE id=?) AND base_revision_id IS ? AND (SELECT id FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC LIMIT 1) IS ?",
            )
            .bind(
              id,
              revisionNumber,
              json,
              await hash(json),
              input.commandId,
              commandHash,
              actor.id,
              now,
              input.requestId,
              draft.version,
              input.sourceHash,
              input.requestId,
              input.baseRevisionId ?? null,
              input.requestId,
              input.baseRevisionId ?? null,
            ),
          db
            .prepare(
              "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) SELECT ?,'quote_revision.issued','quote_revision',?,?,?,? WHERE changes()=1",
            )
            .bind(
              `quote-issued:${id}`,
              id,
              actor.id,
              JSON.stringify({
                requestId: input.requestId,
                preparationVersion: draft.version,
                revisionNumber,
                factoryReviewConfirmed: snapshot.factoryReviewConfirmed,
              }),
              now,
            ),
        ]);
      } catch (error) {
        const completed = await replay();
        if (completed) return completed;
        if (await current(input.requestId))
          throw new Response("Quote changed; reload before issuing", {
            status: 409,
          });
        throw error;
      }
      const completed = await replay();
      if (!completed)
        throw new Response("Quote changed; reload before issuing", {
          status: 409,
        });
      return completed;
    },
  };
}
