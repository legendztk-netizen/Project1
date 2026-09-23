import type { AdminIdentity } from "#workers/admin-access";
import type { QuoteRevisionSnapshot } from "../../quote-review/domain/quote-revision";
import {
  PiLifecycleError,
  planPiReplacement,
  publicPiLifecycle,
  type PiReplacementCommand,
} from "../domain/pi-lifecycle";
import {
  createD1PiLifecycle,
  type PiLifecycleRow,
  type PiReplacementIntentRow,
} from "../infrastructure/d1-pi-lifecycle";
import { lifecycleRecord } from "./pi-lifecycle-record";
import { paymentChannel } from "../../seller-settings/domain/seller-commercial-settings";
import {
  createProformaInvoiceSnapshot,
  piSha256,
  piUtcInstant,
  publicPiPaymentInstructions,
  type ProformaInvoiceSnapshot,
} from "../domain/proforma-invoice";
import { renderProformaInvoicePdf } from "../domain/proforma-invoice-pdf";
import {
  createD1PiReplacementRepository,
  type PiIntentRow,
  type PiRow,
} from "../infrastructure/d1-pi-replacement-repository";

import type {
  IssueProformaInvoiceCommand,
  ProformaInvoiceServiceOptions,
} from "./proforma-invoice-service";
export type ReplaceProformaInvoiceCommand = IssueProformaInvoiceCommand & {
  replacement: PiReplacementCommand;
};

function admin(identity: AdminIdentity) {
  if (!identity?.id || !["owner", "subaccount"].includes(identity.accountType))
    throw new Response("Forbidden", { status: 403 });
}
function customer(profileId: string) {
  if (typeof profileId !== "string" || !profileId.trim())
    throw new Response("Forbidden", { status: 403 });
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
const sha = (text: string) => piSha256(new TextEncoder().encode(text));
const conflict = () =>
  new Response("PI inputs changed; reload before issuing", { status: 409 });

export function createPiLifecycleService(
  db: D1Database,
  privateBucket: R2Bucket,
  options: ProformaInvoiceServiceOptions = {},
) {
  const repository = createD1PiReplacementRepository(db);
  const lifecycle = createD1PiLifecycle(db);
  const now = () => piUtcInstant((options.now?.() ?? new Date()).toISOString());
  const render = options.renderPdf ?? renderProformaInvoicePdf;

  async function publicRecord(row: PiRow) {
    if ((await sha(row.snapshot_json)) !== row.snapshot_hash)
      throw new Response("PI snapshot integrity failure", { status: 409 });
    const snapshot = JSON.parse(row.snapshot_json) as ProformaInvoiceSnapshot;
    const currentPayment = await repository.currentPayment(row.payment_channel);
    let paymentInstructions: ReturnType<
      typeof publicPiPaymentInstructions
    > | null = null;
    try {
      paymentInstructions = publicPiPaymentInstructions(
        currentPayment,
        row.payment_channel,
      );
    } catch {
      /* Never fall back to superseded banking details. */
    }
    return {
      id: row.id,
      requestId: row.request_id,
      quoteRevisionId: row.quote_revision_id,
      previousPiId: row.previous_pi_id,
      snapshot,
      snapshotHash: row.snapshot_hash,
      pdf: {
        sha256: row.pdf_sha256,
        byteSize: row.pdf_byte_size,
        pageCount: row.pdf_page_count,
        rendererVersion: row.pdf_renderer_version,
      },
      paymentInstructions,
    };
  }

  async function lifecycleView(row: PiLifecycleRow) {
    if ((await sha(row.snapshot_json)) !== row.snapshot_hash)
      throw new Response("PI snapshot integrity failure", { status: 409 });
    return publicPiLifecycle(lifecycleRecord(row), {
      currentPiId: row.current_pi_id,
      currentQuoteRevisionId: row.accepted_agreement_retained
        ? row.quote_revision_id
        : row.current_quote_revision_id,
      now: now(),
    });
  }

  const service = {
    async replace(actor: AdminIdentity, input: ReplaceProformaInvoiceCommand) {
      const reserved = await service.reserveReplacement(actor, input);
      return service.renderReserved(reserved.commandId);
    },
    async reserveReplacement(
      actor: AdminIdentity,
      input: ReplaceProformaInvoiceCommand,
    ) {
      admin(actor);
      if (!input.replacement)
        throw new Response("Explicit replacement review required", {
          status: 400,
        });
      try {
        const intent = await service.reserveIntent(actor, input);
        return { commandId: intent.command_id, piId: intent.id };
      } catch (error) {
        if (error instanceof PiLifecycleError) throw conflict();
        throw error;
      }
    },
    async replacementReadiness(actor: AdminIdentity, requestId: string) {
      admin(actor);
      const row = await lifecycle.current(requestId);
      if (!row) throw new Response("Not found", { status: 404 });
      return {
        lifecycle: await lifecycleView(row),
        expectedPi: {
          piId: row.id,
          documentVersion: row.document_version,
          snapshotHash: row.snapshot_hash,
        },
        expectedHeadVersion: row.head_version,
        expectedAcceptanceId: row.acceptance_id,
        nextQuoteRevisionId: row.current_quote_revision_id,
        evidence: await lifecycle.evidence(requestId),
        pdfJobs: await lifecycle.pdfJobs(requestId),
      };
    },
    async adminHistory(actor: AdminIdentity, requestId: string) {
      admin(actor);
      const rows = await lifecycle.history(requestId);
      const records = [];
      for (const row of rows)
        records.push({
          ...(await publicRecord(row)),
          lifecycle: await lifecycleView(row),
        });
      return records;
    },
    async customerHistory(profileId: string, requestId: string) {
      customer(profileId);
      await repository.requireOwnedQuote(profileId, requestId);
      const rows = await lifecycle.history(requestId, profileId);
      const records = [];
      for (const row of rows) {
        const state = await lifecycleView(row);
        const snapshot = JSON.parse(
          row.snapshot_json,
        ) as ProformaInvoiceSnapshot;
        records.push({
          id: row.id,
          requestId: row.request_id,
          snapshotHash: row.snapshot_hash,
          snapshot: {
            documentNumber: snapshot.documentNumber,
            documentVersion: snapshot.documentVersion,
            issuedAt: snapshot.issuedAt,
            totals: { totalCents: snapshot.totals.totalCents },
          },
          lifecycle: state,
        });
      }
      await repository.requireOwnedQuote(profileId, requestId);
      return records;
    },
    async reserveIntent(
      actor: AdminIdentity,
      input: ReplaceProformaInvoiceCommand,
    ) {
      admin(actor);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.commandId,
        )
      )
        throw new Response("Valid command id required", { status: 400 });
      for (const value of [
        input.requestId,
        input.quoteRevisionId,
        input.quoteRevisionHash,
        input.sellerIdentityId,
        input.paymentInstructionId,
      ])
        if (typeof value !== "string" || !value.trim())
          throw new Response("Explicit PI source versions required", {
            status: 400,
          });
      for (const value of [
        input.sellerVersion,
        input.paymentInstructionVersion,
      ])
        if (!Number.isSafeInteger(value) || value < 1)
          throw new Response("Explicit PI source versions required", {
            status: 400,
          });
      const channel = paymentChannel(input.paymentChannel);
      const commandId = input.commandId.toLowerCase();
      const commandHash = await sha(
        JSON.stringify(
          canonical({
            requestId: input.requestId,
            quoteRevisionId: input.quoteRevisionId,
            quoteRevisionHash: input.quoteRevisionHash,
            sellerIdentityId: input.sellerIdentityId,
            sellerVersion: input.sellerVersion,
            paymentChannel: channel,
            paymentInstructionId: input.paymentInstructionId,
            paymentInstructionVersion: input.paymentInstructionVersion,
            validUntil:
              input.validUntil === undefined
                ? null
                : piUtcInstant(input.validUntil),
            fixedPaymentDueDateEt: input.fixedPaymentDueDateEt ?? null,
            ...(input.replacement ? { replacement: input.replacement } : {}),
          }),
        ),
      );
      function check(intent: PiIntentRow) {
        if (
          intent.issued_by !== actor.id ||
          intent.command_hash !== commandHash ||
          intent.request_id !== input.requestId
        )
          throw new Response("PI command conflict", { status: 409 });
        return intent;
      }
      let intent = await repository.intent(commandId);
      if (intent) {
        check(intent);
        const completed = await repository.byId(intent.request_id, intent.id);
        if (completed) return intent;
      } else {
        if (!input.replacement && (await repository.current(input.requestId)))
          throw conflict();
        const quote = await repository.currentQuote(input.requestId);
        const seller = await repository.currentSeller();
        const payment = await repository.currentPayment(channel);
        if (
          !quote ||
          quote.id !== input.quoteRevisionId ||
          quote.snapshot_hash !== input.quoteRevisionHash ||
          !seller ||
          seller.id !== input.sellerIdentityId ||
          seller.version !== input.sellerVersion ||
          !payment ||
          payment.id !== input.paymentInstructionId ||
          payment.version !== input.paymentInstructionVersion
        )
          throw conflict();
        if ((await sha(quote.snapshot_json)) !== quote.snapshot_hash)
          throw new Response("Quote snapshot integrity failure", {
            status: 409,
          });
        const revision = JSON.parse(
          quote.snapshot_json,
        ) as QuoteRevisionSnapshot;
        if (revision.requestId !== input.requestId)
          throw new Response("Quote source mismatch", { status: 409 });
        let replacement: PiReplacementIntentRow | undefined;
        let documentVersion = 1;
        if (input.replacement) {
          const old = await lifecycle.current(input.requestId);
          if (
            !old ||
            (await sha(old.snapshot_json)) !== old.snapshot_hash ||
            (await sha(old.source_revision_json)) !== old.source_revision_hash
          )
            throw conflict();
          const plan = planPiReplacement(
            {
              pi: lifecycleRecord(old),
              head: { piId: old.current_pi_id, version: old.head_version },
              previousQuote: {
                id: old.quote_revision_id,
                snapshot: JSON.parse(
                  old.source_revision_json,
                ) as QuoteRevisionSnapshot,
              },
              nextQuote: { id: quote.id, snapshot: revision },
              currentQuoteRevisionId: quote.id,
              now: now(),
            },
            input.replacement,
          );
          if (!plan.replacement)
            throw new Response(
              JSON.stringify({
                decision: plan.decision,
                acceptedTotalCents: plan.acceptedTotalCents,
                automaticRefundCents: 0,
              }),
              { status: 409, headers: { "Content-Type": "application/json" } },
            );
          documentVersion = plan.replacement.nextDocumentVersion;
          replacement = {
            pi_id: "",
            previous_pi_id: old.id,
            expected_head_version: old.head_version,
            expected_document_version: old.document_version,
            expected_snapshot_hash: old.snapshot_hash,
            expected_acceptance_id: old.acceptance_id,
            previous_snapshot_json: old.snapshot_json,
            previous_source_json: old.source_revision_json,
            reason_json: JSON.stringify(plan.auditReason),
            material_json: JSON.stringify(plan.material),
          };
        }
        const conditions = options.conditions
          ? structuredClone(
              typeof options.conditions === "function"
                ? options.conditions(structuredClone(revision))
                : options.conditions,
            )
          : undefined;
        if (!conditions)
          throw new Error(
            "Explicit versioned PI conditions configuration required",
          );
        const id = `pi-${await sha(commandId)}`;
        const snapshot = createProformaInvoiceSnapshot({
          documentNumber: `PI-${id.slice(3, 27).toUpperCase()}`,
          documentVersion,
          issuedAt: now(),
          validUntil: input.validUntil,
          fixedPaymentDueDateEt: input.fixedPaymentDueDateEt,
          quoteRevisionId: quote.id,
          currentQuoteRevisionId: quote.id,
          revision,
          seller,
          selectedPaymentChannel: channel,
          paymentInstructions: payment,
          conditions,
        });
        const json = JSON.stringify(snapshot);
        const proposed: PiIntentRow = {
          id,
          command_id: commandId,
          command_hash: commandHash,
          request_id: input.requestId,
          quote_revision_id: quote.id,
          quote_revision_hash: quote.snapshot_hash,
          source_revision_json: quote.snapshot_json,
          seller_identity_id: seller.id,
          seller_version: seller.version,
          payment_instruction_id: payment.id,
          payment_instruction_version: payment.version,
          payment_channel: channel,
          snapshot_json: json,
          snapshot_hash: await sha(json),
          issued_by: actor.id,
          issued_at: snapshot.issuedAt,
          valid_until: snapshot.validUntil,
        };
        if (!replacement) throw conflict();
        try {
          await repository.reserve(proposed, { ...replacement, pi_id: id });
        } catch (error) {
          const saved = await repository.intent(commandId);
          if (!saved) throw error;
          check(saved);
        }
        intent = check((await repository.intent(commandId))!);
      }
      if (!(await repository.byId(intent.request_id, intent.id)))
        await repository.assertCurrent(intent);
      return intent;
    },
    // Internal durable PDF queue entry point, not an unauthenticated HTTP action.
    async renderReserved(commandId: string) {
      const intent = await repository.intent(commandId);
      if (!intent) throw new Response("PI intent not found", { status: 404 });
      if (!(await lifecycle.intent(intent.id))) throw conflict();
      // A concurrent identical command may already have completed while reserving.
      const replay = await repository.byId(intent.request_id, intent.id);
      if (replay) return publicRecord(replay);
      try {
        await repository.assertCurrent(intent);
      } catch (error) {
        const completed = await repository.byId(intent.request_id, intent.id);
        if (completed) return publicRecord(completed);
        throw error;
      }
      if (intent.valid_until <= now())
        throw new Error("PI validity deadline must be in the future");
      if (
        (await sha(intent.snapshot_json)) !== intent.snapshot_hash ||
        (await sha(intent.source_revision_json)) !== intent.quote_revision_hash
      )
        throw conflict();
      const snapshot = JSON.parse(
        intent.snapshot_json,
      ) as ProformaInvoiceSnapshot;
      const pdf = await render(snapshot);
      if (
        !(pdf.bytes instanceof Uint8Array) ||
        !pdf.bytes.byteLength ||
        pdf.bytes.byteLength > 25 * 1024 * 1024 ||
        !Number.isSafeInteger(pdf.pageCount) ||
        pdf.pageCount < 1 ||
        !pdf.rendererVersion ||
        (await piSha256(pdf.bytes)) !== pdf.sha256
      )
        throw new Error("Invalid PI PDF output");
      // Content addressing + conditional creation means neither retries nor losers overwrite bytes.
      const objectKey = `proforma-invoices/${intent.id}/${pdf.sha256}.pdf`;
      try {
        await privateBucket.put(objectKey, pdf.bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: { contentType: "application/pdf" },
          customMetadata: {
            piId: intent.id,
            sha256: pdf.sha256,
            snapshotHash: intent.snapshot_hash,
            rendererVersion: pdf.rendererVersion,
          },
        });
      } catch (error) {
        const saved = await privateBucket.get(objectKey);
        if (
          !saved ||
          saved.size !== pdf.bytes.byteLength ||
          (await piSha256(new Uint8Array(await saved.arrayBuffer()))) !==
            pdf.sha256
        )
          throw error;
      }
      const object = await privateBucket.get(objectKey);
      if (
        !object ||
        object.size !== pdf.bytes.byteLength ||
        (await piSha256(new Uint8Array(await object.arrayBuffer()))) !==
          pdf.sha256
      )
        throw new Error("PI PDF storage integrity failure");
      if (intent.valid_until <= now())
        throw new Error("PI validity deadline must be in the future");
      try {
        await repository.publish(
          intent,
          {
            objectKey,
            sha256: pdf.sha256,
            byteSize: pdf.bytes.byteLength,
            pageCount: pdf.pageCount,
            rendererVersion: pdf.rendererVersion,
          },
          now(),
        );
      } catch (error) {
        const completed = await repository.byId(intent.request_id, intent.id);
        if (completed) return publicRecord(completed);
        // Never delete after an uncertain commit: another attempt can reference these same bytes.
        if (await repository.current(intent.request_id)) throw conflict();
        throw error;
      }
      const completed = await repository.byId(intent.request_id, intent.id);
      if (!completed) throw conflict();
      return publicRecord(completed);
    },
  };
  return {
    replace: service.replace,
    reserveReplacement: service.reserveReplacement,
    renderReserved: service.renderReserved,
    replacementReadiness: service.replacementReadiness,
    adminHistory: service.adminHistory,
    customerHistory: service.customerHistory,
  };
}
