import type { AdminIdentity } from "#workers/admin-access";
import { requireReviewMutation } from "../../quote-review/domain/private-review";
import type { NotificationProtector } from "../../quote-notifications";
import { parseInboundMime } from "../../quote-inbound-email/infrastructure/mime-parser";
import {
  validatePiAcceptance,
  type PiAcceptanceInput,
} from "../domain/pi-acceptance";
import {
  piSha256,
  piUtcInstant,
  type ProformaInvoiceSnapshot,
} from "../domain/proforma-invoice";
import { createD1PiAcceptance } from "../infrastructure/d1-pi-acceptance";
import {
  createD1PiEmailAcceptance,
  type PiEmailSource,
} from "../infrastructure/d1-pi-email-acceptance";
import {
  piAcceptanceProjection,
  type PiRequestEvidence,
} from "./pi-acceptance-service";

export interface AcceptPiFromEmailInput extends PiAcceptanceInput {
  requestId: string;
  commandId: string;
  sourceMessageId: string;
  explicitlyConfirmed: boolean;
  review: {
    piReferenceExcerpt: string;
    generalExcerpt: string;
    madeToOrder: Array<{
      lineIds: string[];
      specificationExcerpt: string;
      cancellationExcerpt: string;
    }>;
  };
}
const sha = (value: string) => piSha256(new TextEncoder().encode(value));
function required(value: string, label: string, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Response(`${label} required`, { status: 400 });
  return value.trim();
}
function conflict() {
  return new Response("PI email acceptance conflict", { status: 409 });
}

// inboundProtector must be the same persistent protector used by #58, not form data.
export function createPiEmailAcceptanceService(
  db: D1Database,
  bucket: R2Bucket,
  options: {
    inboundProtector: NotificationProtector;
    appEnvironment: "local" | "preview" | "production";
    now?: () => Date;
  },
) {
  const acceptance = createD1PiAcceptance(db);
  const repository = createD1PiEmailAcceptance(db);
  const now = () => piUtcInstant((options.now?.() ?? new Date()).toISOString());
  async function verifyPrivateSource(source: PiEmailSource) {
    let envelope;
    try {
      envelope = JSON.parse(
        await options.inboundProtector.open(
          source.protected_envelope,
          `inbound:${source.id}`,
        ),
      );
    } catch {
      throw new Response("Private email evidence unavailable", {
        status: 409,
      });
    }
    if (
      !envelope ||
      envelope.sender !== source.email ||
      envelope.profileId !== source.profile_id ||
      envelope.requestId !== source.request_id ||
      envelope.rawChecksum !== source.raw_checksum ||
      ![
        "cloudflare-email",
        ...(options.appEnvironment === "local" ? ["local-fixture"] : []),
      ].includes(envelope.provider)
    )
      throw new Response("Verified sender evidence mismatch", {
        status: 409,
      });
    if (
      !Number.isSafeInteger(source.raw_size) ||
      source.raw_size < 1 ||
      source.raw_size > 15 * 1024 * 1024
    )
      throw conflict();
    const object = await bucket.get(source.raw_key);
    if (!object || object.size !== source.raw_size)
      throw new Response("Private email bytes unavailable", { status: 409 });
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (
      bytes.byteLength !== source.raw_size ||
      (await piSha256(bytes)) !== source.raw_checksum
    )
      throw new Response("Private email integrity failure", { status: 409 });
    try {
      const parsed = await parseInboundMime(bytes, source.email);
      if (parsed.body !== source.body) throw new Error("Message mismatch");
    } catch {
      throw new Response("Private email content mismatch", { status: 409 });
    }
  }
  return {
    async adminPage(
      actor: AdminIdentity,
      requestId: string,
      piId: string,
      selection: { sourceMessageId?: string; before?: string } = {},
    ) {
      if (
        !actor?.id ||
        !["owner", "subaccount"].includes(actor.accountType) ||
        (actor.source === "local-development" &&
          options.appEnvironment !== "local")
      )
        throw new Response("Forbidden", { status: 403 });
      const row = await repository.adminPi(
        required(requestId, "Quote request"),
        required(piId, "PI id"),
      );
      if (!row) throw new Response("Not found", { status: 404 });
      if ((await sha(row.snapshot_json)) !== row.snapshot_hash)
        throw conflict();
      const fixed = JSON.parse(row.snapshot_json) as ProformaInvoiceSnapshot;
      if (
        fixed.documentVersion !== row.document_version ||
        fixed.quoteRevision.id !== row.quote_revision_id ||
        fixed.quoteRevision.requestId !== row.request_id ||
        fixed.documentNumber !== row.document_number
      )
        throw conflict();
      const choices = await repository.sourceChoices(
        requestId,
        selection.before,
      );
      const emails: Array<{
        id: string;
        sender: string;
        receivedAt: string;
        preview: string;
      }> = [];
      for (const source of choices.rows) {
        if (await acceptance.owned(source.profile_id, requestId, piId))
          emails.push({
            id: source.message_id,
            sender: source.email,
            receivedAt: new Date(source.created_at).toISOString(),
            preview: source.body.slice(0, 100),
          });
      }
      let selected: {
        id: string;
        sender: string;
        receivedAt: string;
        body: string;
        profileId: string;
      } | null = null;
      let sourceError: string | null = null;
      if (selection.sourceMessageId) {
        const source = await repository.source(
          requestId,
          required(selection.sourceMessageId, "Source email"),
        );
        if (
          !source ||
          !(await acceptance.owned(source.profile_id, requestId, piId))
        ) {
          sourceError = "邮件不存在，或发件人已无此询价的确认权限。";
        } else {
          try {
            await verifyPrivateSource(source);
            selected = {
              id: source.message_id,
              sender: source.email,
              receivedAt: new Date(source.created_at).toISOString(),
              body: source.body,
              profileId: source.profile_id,
            };
          } catch {
            sourceError = "私有邮件原文校验失败，不能用于确认。";
          }
        }
      }
      const current =
        row.current_pi_id === row.id &&
        row.current_quote_revision_id === row.quote_revision_id;
      const expired = now() >= piUtcInstant(row.valid_until);
      return {
        requestId,
        piId: row.id,
        documentNumber: row.document_number,
        documentVersion: row.document_version,
        snapshotHash: row.snapshot_hash,
        issuedAt: row.issued_at,
        validUntil: row.valid_until,
        current,
        expired,
        accepted: !!row.acceptance_id,
        canAccept:
          current &&
          !expired &&
          !row.acceptance_id &&
          now() >= piUtcInstant(row.issued_at) &&
          !!selected,
        conditions: fixed.conditions,
        lines: fixed.lines
          .filter((line) => line.madeToOrder)
          .map((line) => ({ id: line.id, sku: line.sku ?? line.id })),
        emails,
        nextCursor: choices.nextCursor,
        selected,
        sourceError,
      };
    },
    async accept(
      actor: AdminIdentity,
      request: Request,
      input: AcceptPiFromEmailInput,
      requestEvidence: PiRequestEvidence,
    ) {
      if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
        throw new Response("Forbidden", { status: 403 });
      requireReviewMutation(request);
      if (!input || typeof input !== "object")
        throw new Response("Email acceptance input required", { status: 400 });
      if (
        actor.source === "local-development" &&
        options.appEnvironment !== "local"
      )
        throw new Response("Forbidden", { status: 403 });
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.commandId,
        )
      )
        throw new Response("Command required", { status: 400 });
      if (input.explicitlyConfirmed !== true)
        throw new Response("Explicit email acceptance review required", {
          status: 400,
        });
      const source = await repository.source(
        required(input.requestId, "Quote request"),
        required(input.sourceMessageId, "Source email"),
      );
      if (!source)
        throw new Response(
          "Authenticated customer email for this quote required",
          { status: 400 },
        );
      const row = await acceptance.owned(
        source.profile_id,
        source.request_id,
        required(input.piId, "PI id"),
      );
      if (!row)
        throw new Response("Customer no longer authorized", { status: 403 });
      if (
        input.documentVersion !== row.document_version ||
        input.snapshotHash !== row.snapshot_hash ||
        (await sha(row.snapshot_json)) !== row.snapshot_hash
      )
        throw conflict();
      const fixed = JSON.parse(row.snapshot_json) as ProformaInvoiceSnapshot;
      if (
        fixed.documentVersion !== row.document_version ||
        fixed.quoteRevision.id !== row.quote_revision_id ||
        fixed.quoteRevision.requestId !== row.request_id ||
        piUtcInstant(fixed.issuedAt) !== piUtcInstant(row.issued_at) ||
        piUtcInstant(fixed.validUntil) !== piUtcInstant(row.valid_until)
      )
        throw conflict();
      const excerpt = (value: string, label: string) => {
        const text = required(value, label, 4000);
        if (!source.body.includes(text))
          throw new Response(
            `${label} must quote the customer's received message`,
            { status: 400 },
          );
        return text;
      };
      const reference = excerpt(
        input.review?.piReferenceExcerpt,
        "PI reference evidence",
      );
      const documentNumber = required(fixed.documentNumber, "Issued PI number");
      const escapedNumber = documentNumber.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      if (
        !new RegExp(`(?<![A-Za-z0-9_-])${escapedNumber}(?![A-Za-z0-9_-])`).test(
          reference,
        )
      )
        throw new Response("Email must identify this exact PI number", {
          status: 400,
        });
      const general = excerpt(
        input.review.generalExcerpt,
        "General acknowledgement evidence",
      );
      const customIds = fixed.lines
        .filter((line) => line.madeToOrder)
        .map((line) => line.id);
      if (
        !Array.isArray(input.review.madeToOrder) ||
        input.review.madeToOrder.length > customIds.length
      )
        throw new Response("Line evidence required", { status: 400 });
      const lineEvidence = input.review.madeToOrder
        .flatMap((group) => {
          if (
            !group ||
            !Array.isArray(group.lineIds) ||
            !group.lineIds.length ||
            group.lineIds.length > customIds.length
          )
            throw new Response("Identified custom lines required", {
              status: 400,
            });
          return group.lineIds.map((lineId) => ({
            lineId: required(lineId, "Line id"),
            specificationExcerpt: excerpt(
              group.specificationExcerpt,
              "Specification evidence",
            ),
            cancellationExcerpt: excerpt(
              group.cancellationExcerpt,
              "Cancellation evidence",
            ),
          }));
        })
        .sort((a, b) => a.lineId.localeCompare(b.lineId));
      if (
        lineEvidence.length !== customIds.length ||
        new Set(lineEvidence.map((line) => line.lineId)).size !==
          customIds.length ||
        lineEvidence.some((line) => !customIds.includes(line.lineId))
      )
        throw new Response(
          "Evidence must cover every made-to-order line exactly once",
          { status: 400 },
        );
      const review = {
        piReferenceExcerpt: reference,
        generalExcerpt: general,
        madeToOrder: lineEvidence,
      };
      let acknowledgements;
      try {
        if (
          !Array.isArray(input.acknowledgements.madeToOrder) ||
          input.acknowledgements.madeToOrder.length > customIds.length
        )
          throw new Error();
        acknowledgements = {
          general: {
            version: input.acknowledgements.general.version,
            confirmed: input.acknowledgements.general.confirmed === true,
          },
          madeToOrder: input.acknowledgements.madeToOrder
            .flatMap((group) => {
              if (
                !Array.isArray(group.lineIds) ||
                !group.lineIds.length ||
                group.lineIds.length > customIds.length
              )
                throw new Error();
              return group.lineIds.map((lineId) => ({
                lineId,
                version: group.version,
                cancellationVersion: group.cancellationVersion,
                specificationsConfirmed: group.specificationsConfirmed === true,
                cancellationConfirmed: group.cancellationConfirmed === true,
              }));
            })
            .sort((a, b) => a.lineId.localeCompare(b.lineId)),
        };
      } catch {
        throw new Response("Explicit versioned acknowledgements required", {
          status: 400,
        });
      }
      const commandId = input.commandId.toLowerCase();
      const businessHash = await sha(
        JSON.stringify({
          source: "email",
          actorId: actor.id,
          piId: row.id,
          documentVersion: row.document_version,
          snapshotHash: row.snapshot_hash,
          profileId: source.profile_id,
          purchasingContextId: row.purchasing_context_id,
          legalName: required(input.legalName, "Legal name", 300),
          sourceMessageId: source.message_id,
          receiptId: source.id,
          rawHash: source.raw_checksum,
          acknowledgements,
          review,
        }),
      );
      const commandHash = businessHash;
      async function replay() {
        const command = await acceptance.command(commandId);
        if (
          command &&
          (command.command_hash !== commandHash ||
            command.pi_id !== row!.id ||
            command.profile_id !== source!.profile_id)
        )
          throw conflict();
        const accepted = await acceptance.acceptance(
          row!.id,
          source!.profile_id,
        );
        if (!accepted) return null;
        if (
          accepted.source !== "email" ||
          accepted.business_hash !== businessHash ||
          accepted.profile_id !== source!.profile_id ||
          accepted.purchasing_context_id !== row!.purchasing_context_id
        )
          throw conflict();
        if (!command) {
          try {
            await acceptance.replay({
              commandId,
              commandHash,
              businessHash,
              piId: row!.id,
              profileId: source!.profile_id,
              source: "email",
            });
          } catch (error) {
            if (!(await acceptance.command(commandId))) throw error;
          }
        }
        const saved = await acceptance.command(commandId);
        if (
          !saved ||
          saved.command_hash !== commandHash ||
          saved.acceptance_id !== accepted.id
        )
          throw conflict();
        if (
          !(await acceptance.owned(
            source!.profile_id,
            row!.request_id,
            row!.id,
          ))
        )
          throw new Response("Forbidden", { status: 403 });
        return piAcceptanceProjection(accepted);
      }
      await verifyPrivateSource(source);
      // Replays retain their original result after expiry, but never bypass
      // current customer authorization or private source integrity checks.
      const existing = await replay();
      if (existing) return existing;
      const evidenceId = crypto.randomUUID();
      let evidence;
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
            customerAuthorized: true,
            customer: {
              profileId: source.profile_id,
              purchasingContextId: row.purchasing_context_id,
            },
            now: now(),
            requestEvidence,
            source: {
              source: "email",
              admin: actor,
              explicitlyConfirmed: true,
              evidence: {
                id: evidenceId,
                piId: row.id,
                documentVersion: row.document_version,
                snapshotHash: row.snapshot_hash,
                profileId: source.profile_id,
                purchasingContextId: row.purchasing_context_id,
                occurredAt: new Date(source.created_at).toISOString(),
                sourceMessageId: source.message_id,
                acknowledgementEvidenceId: evidenceId,
              },
            },
          },
          input,
        );
      } catch (error) {
        throw new Response(
          error instanceof Error ? error.message : "Invalid email acceptance",
          { status: 400 },
        );
      }
      try {
        await repository.accept(row, {
          id: crypto.randomUUID(),
          evidenceId,
          adminId: actor.id,
          commandId,
          commandHash,
          businessHash,
          evidence,
          source,
          reviewJson: JSON.stringify(review),
        });
      } catch (error) {
        const saved = await replay();
        if (saved) return saved;
        throw error;
      }
      const saved = await replay();
      if (!saved) throw conflict();
      return saved;
    },
  };
}
