import { requireReviewMutation } from "../../quote-review/domain/private-review";
import {
  validatePiAcceptance,
  type PiAcceptance,
  type PiAcceptanceContext,
  type PiAcceptanceInput,
  type PiAcceptanceTarget,
} from "../domain/pi-acceptance";
import {
  piSha256,
  piUtcInstant,
  type ProformaInvoiceSnapshot,
} from "../domain/proforma-invoice";
import {
  createD1PiAcceptance,
  type AcceptancePiRow,
  type PiAcceptanceRow,
} from "../infrastructure/d1-pi-acceptance";

export type PiRequestEvidence = PiAcceptanceContext["requestEvidence"];
export interface AcceptWebsitePiInput extends PiAcceptanceInput {
  requestId: string;
  commandId: string;
  viewId: string;
}
const conflict = () =>
  new Response("PI acceptance conflict; reload the current PI", {
    status: 409,
  });
const sha = (text: string) => piSha256(new TextEncoder().encode(text));
function required(value: string, label: string, limit = 300) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Response(`${label} required`, { status: 400 });
  return value.trim();
}
function metadata(value: PiRequestEvidence): PiRequestEvidence {
  const requestId = required(value?.requestId, "Request evidence", 2000);
  for (const [name, limit] of [
    ["ipAddress", 128],
    ["userAgent", 4096],
  ] as const)
    if (
      value[name] !== null &&
      (typeof value[name] !== "string" ||
        !value[name].trim() ||
        value[name].length > limit)
    )
      throw new Response(`Invalid ${name} evidence`, { status: 400 });
  return { requestId, ipAddress: value.ipAddress, userAgent: value.userAgent };
}
function exactTarget(row: AcceptancePiRow, target: PiAcceptanceTarget) {
  if (
    target.piId !== row.id ||
    target.documentVersion !== row.document_version ||
    target.snapshotHash !== row.snapshot_hash
  )
    throw conflict();
}
function live(row: AcceptancePiRow, now: string) {
  return (
    row.current_pi_id === row.id &&
    row.current_quote_revision_id === row.quote_revision_id &&
    piUtcInstant(row.issued_at) <= now &&
    piUtcInstant(row.valid_until) > now
  );
}
export function piAcceptanceProjection(row: PiAcceptanceRow) {
  const evidence = JSON.parse(row.evidence_json) as PiAcceptance;
  return {
    id: row.id,
    status: "PI Accepted" as const,
    piId: evidence.piId,
    documentVersion: evidence.documentVersion,
    snapshotHash: evidence.snapshotHash,
    quoteRevisionId: evidence.quoteRevisionId,
    legalName: evidence.legalName,
    acceptedAt: evidence.acceptedAt,
    source: evidence.evidence.source,
    policySource: evidence.policySource,
    acknowledgements: evidence.acknowledgements,
  };
}

// profileId and requestEvidence come from server authentication/request context.
// No email, IP, UA, policy text, ownership flag or acceptance time comes from forms.
export function createPiAcceptanceService(
  db: D1Database,
  bucket: R2Bucket,
  options: { now?: () => Date } = {},
) {
  const repository = createD1PiAcceptance(db);
  const now = () => piUtcInstant((options.now?.() ?? new Date()).toISOString());
  async function owned(profileId: string, requestId: string, piId?: string) {
    required(profileId, "Authenticated profile");
    required(requestId, "Quote request");
    const row = await repository.owned(profileId, requestId, piId);
    if (!row) throw new Response("Not found", { status: 404 });
    return row;
  }
  async function snapshot(row: AcceptancePiRow) {
    if ((await sha(row.snapshot_json)) !== row.snapshot_hash) throw conflict();
    const result = JSON.parse(row.snapshot_json) as ProformaInvoiceSnapshot;
    if (
      result.schemaVersion !== 1 ||
      result.documentVersion !== row.document_version ||
      result.quoteRevision.id !== row.quote_revision_id ||
      result.quoteRevision.requestId !== row.request_id ||
      piUtcInstant(result.issuedAt) !== piUtcInstant(row.issued_at) ||
      piUtcInstant(result.validUntil) !== piUtcInstant(row.valid_until)
    )
      throw conflict();
    return result;
  }
  async function views(row: AcceptancePiRow, profileId: string) {
    return (await repository.views(row, profileId)).filter(
      (view) =>
        view.document_version === row.document_version &&
        view.snapshot_hash === row.snapshot_hash &&
        view.pdf_sha256 === row.pdf_sha256 &&
        view.pdf_byte_size === row.pdf_byte_size,
    );
  }
  return {
    async customerStatus(profileId: string, requestId: string, piId?: string) {
      const row = await owned(profileId, requestId, piId);
      await snapshot(row);
      const acceptance = await repository.acceptance(row.id, profileId);
      const seen = await views(row, profileId);
      return {
        piId: row.id,
        documentVersion: row.document_version,
        snapshotHash: row.snapshot_hash,
        current:
          row.current_pi_id === row.id &&
          row.current_quote_revision_id === row.quote_revision_id,
        expired: now() >= piUtcInstant(row.valid_until),
        status: acceptance ? ("PI Accepted" as const) : ("PI Ready" as const),
        canAccept: !acceptance && seen.length > 0 && live(row, now()),
        viewId: seen[0]?.id ?? null,
        acceptance: acceptance ? piAcceptanceProjection(acceptance) : null,
      };
    },
    async customerViews(profileId: string, requestId: string, piId: string) {
      const row = await owned(profileId, requestId, piId);
      return (await views(row, profileId)).map((view) => ({
        id: view.id,
        piId: view.pi_id,
        documentVersion: view.document_version,
        snapshotHash: view.snapshot_hash,
        kind: view.kind,
        occurredAt: view.occurred_at,
      }));
    },
    // This endpoint validates stored bytes itself; callers cannot mint evidence
    // by submitting a "viewed" flag or by merely reading the JSON snapshot.
    async customerView(
      profileId: string,
      requestId: string,
      target: PiAcceptanceTarget,
      kind: "view" | "download",
      requestEvidence: PiRequestEvidence,
    ) {
      if (!["view", "download"].includes(kind))
        throw new Response("Invalid viewing kind", { status: 400 });
      const captured = metadata(requestEvidence);
      const row = await owned(
        profileId,
        requestId,
        required(target.piId, "PI id"),
      );
      exactTarget(row, target);
      await snapshot(row);
      if (!live(row, now())) throw conflict();
      if (
        !Number.isSafeInteger(row.pdf_byte_size) ||
        row.pdf_byte_size < 1 ||
        row.pdf_byte_size > 25 * 1024 * 1024
      )
        throw new Response("PI PDF exceeds supported size", { status: 409 });
      const object = await bucket.get(row.pdf_object_key);
      if (!object) throw new Response("PI PDF unavailable", { status: 404 });
      if (object.size !== row.pdf_byte_size) throw conflict();
      const bytes = await object.arrayBuffer();
      if (
        bytes.byteLength !== row.pdf_byte_size ||
        (await piSha256(new Uint8Array(bytes))) !== row.pdf_sha256
      )
        throw new Response("PI PDF integrity failure", { status: 409 });
      await repository.recordView(row, profileId, {
        id: crypto.randomUUID(),
        kind,
        now: now(),
        requestEvidenceJson: JSON.stringify(captured),
      });
      const current = await owned(profileId, requestId, row.id);
      if (!live(current, now()) || current.head_version !== row.head_version)
        throw conflict();
      const view = (await views(current, profileId)).find(
        (value) => value.kind === kind,
      );
      if (!view) throw conflict();
      return {
        view: { id: view.id, kind: view.kind, occurredAt: view.occurred_at },
        response: new Response(bytes, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `${kind === "view" ? "inline" : "attachment"}; filename="PI.pdf"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Referrer-Policy": "no-referrer",
          },
        }),
      };
    },
    async accept(
      profileId: string,
      request: Request,
      input: AcceptWebsitePiInput,
      requestEvidence: PiRequestEvidence,
    ) {
      requireReviewMutation(request);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.commandId,
        )
      )
        throw new Response("Valid command id required", { status: 400 });
      const row = await owned(
        profileId,
        input.requestId,
        required(input.piId, "PI id"),
      );
      exactTarget(row, input);
      const captured = metadata(requestEvidence);
      const fixed = await snapshot(row);
      const commandId = input.commandId.toLowerCase();
      const viewId = required(input.viewId, "Successful PI view evidence");
      let businessHash: string;
      try {
        const acknowledgements = input.acknowledgements;
        if (
          !Array.isArray(acknowledgements?.madeToOrder) ||
          acknowledgements.madeToOrder.length > fixed.lines.length
        )
          throw new Error("Invalid acknowledgement groups");
        const lines = acknowledgements.madeToOrder
          .flatMap((group) => {
            if (
              !Array.isArray(group.lineIds) ||
              group.lineIds.length > fixed.lines.length ||
              !group.lineIds.length
            )
              throw new Error("Invalid acknowledged lines");
            return group.lineIds.map((lineId) => ({
              lineId: required(lineId, "Line id"),
              version: required(group.version, "Line policy"),
              cancellationVersion: required(
                group.cancellationVersion,
                "Cancellation version",
              ),
              specificationsConfirmed: group.specificationsConfirmed === true,
              cancellationConfirmed: group.cancellationConfirmed === true,
            }));
          })
          .sort((a, b) => a.lineId.localeCompare(b.lineId));
        businessHash = await sha(
          JSON.stringify({
            source: "website",
            piId: row.id,
            documentVersion: row.document_version,
            snapshotHash: row.snapshot_hash,
            profileId,
            purchasingContextId: row.purchasing_context_id,
            legalName: required(input.legalName, "Legal name"),
            general: {
              version: required(
                acknowledgements.general.version,
                "General policy",
              ),
              confirmed: acknowledgements.general.confirmed === true,
            },
            lines,
          }),
        );
      } catch (error) {
        if (error instanceof Response) throw error;
        throw new Response("Invalid PI acknowledgements", { status: 400 });
      }
      const commandHash = await sha(JSON.stringify({ businessHash, viewId }));
      const receiptInput = {
        commandId,
        commandHash,
        piId: row.id,
        profileId,
        businessHash,
      };
      async function replay() {
        const command = await repository.command(commandId);
        if (
          command &&
          (command.pi_id !== row.id ||
            command.profile_id !== profileId ||
            command.command_hash !== commandHash)
        )
          throw conflict();
        const accepted = await repository.acceptance(row.id, profileId);
        if (!accepted) return null;
        if (
          accepted.source !== "website" ||
          accepted.business_hash !== businessHash ||
          accepted.profile_id !== profileId ||
          accepted.purchasing_context_id !== row.purchasing_context_id
        )
          throw conflict();
        if (!command) {
          try {
            await repository.replay(receiptInput);
          } catch (error) {
            const saved = await repository.command(commandId);
            if (!saved) throw error;
          }
        }
        const saved = await repository.command(commandId);
        if (
          !saved ||
          saved.command_hash !== commandHash ||
          saved.acceptance_id !== accepted.id ||
          saved.profile_id !== profileId
        )
          throw conflict();
        await owned(profileId, row.request_id, row.id);
        return piAcceptanceProjection(accepted);
      }
      const prior = await replay();
      if (prior) return prior;
      const view = (await views(row, profileId)).find(
        (value) => value.id === viewId,
      );
      if (!view)
        throw new Response(
          "Successfully view or download this exact PI first",
          { status: 400 },
        );
      let evidence: PiAcceptance;
      try {
        evidence = validatePiAcceptance(
          {
            pi: {
              piId: row.id,
              documentVersion: row.document_version,
              snapshotHash: row.snapshot_hash,
              snapshot: fixed,
            },
            currentPiId: row.current_pi_id ?? "",
            currentQuoteRevisionId: row.current_quote_revision_id ?? "",
            superseded: row.current_pi_id !== row.id,
            alreadyAccepted: false,
            customer: {
              profileId,
              purchasingContextId: row.purchasing_context_id,
            },
            customerAuthorized: true,
            now: now(),
            requestEvidence: captured,
            source: {
              source: "website",
              customer: {
                profileId,
                purchasingContextId: row.purchasing_context_id,
                verified: true,
              },
              viewing: {
                id: view.id,
                piId: view.pi_id,
                documentVersion: view.document_version,
                snapshotHash: view.snapshot_hash,
                profileId: view.profile_id,
                purchasingContextId: view.purchasing_context_id,
                occurredAt: view.occurred_at,
                kind: view.kind,
                successful: true,
              },
            },
          },
          input,
        );
      } catch (error) {
        if (!live(row, now())) throw conflict();
        throw new Response(
          error instanceof Error ? error.message : "Invalid PI acceptance",
          { status: 400 },
        );
      }
      try {
        await repository.accept(row, {
          ...receiptInput,
          id: crypto.randomUUID(),
          evidence,
          view,
        });
      } catch (error) {
        const completed = await replay();
        if (completed) return completed;
        throw error;
      }
      const completed = await replay();
      if (!completed) {
        await owned(profileId, row.request_id, row.id);
        throw conflict();
      }
      return completed;
    },
  };
}
