import type { AdminIdentity } from "#workers/admin-access";
import { createD1QuoteRequestRepository } from "../../quote-request/infrastructure/d1-quote-request-repository";
import { digest } from "../domain/private-review";
import {
  customerRevisionProjection,
  validateQuoteIssuance,
  type QuoteRevisionSnapshot,
} from "../domain/quote-revision";
import { createQuotePreparation } from "./d1-quote-preparation";

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
    async issueFirst(
      actor: AdminIdentity,
      input: {
        requestId: string;
        preparationVersion: number;
        sourceHash: string;
        factoryReviewConfirmed: boolean;
        commandId: string;
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
      if (
        draft.version !== input.preparationVersion ||
        draft.sourceHash !== input.sourceHash ||
        (await current(input.requestId))
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
      const snapshot: QuoteRevisionSnapshot = {
        version: 1,
        requestId: input.requestId,
        revisionNumber: 1,
        sourceHash: input.sourceHash,
        source: draft.source,
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
              "INSERT INTO quote_revisions(id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at) SELECT ?,request_id,1,version,?,?,?,?,?,? FROM quote_preparation_drafts WHERE request_id=? AND version=? AND source_hash=? AND source_snapshot_json=(SELECT snapshot_json FROM customer_quote_requests WHERE id=?) AND NOT EXISTS(SELECT 1 FROM quote_revisions WHERE request_id=?)",
            )
            .bind(
              id,
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
              input.requestId,
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
                revisionNumber: 1,
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
