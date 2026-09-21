import type { AdminIdentity } from "#workers/admin-access";
import type { QuoteRevisionSnapshot } from "../../quote-review/domain/quote-revision";
import {
  paymentChannel,
  type PaymentChannel,
} from "../../seller-settings/domain/seller-commercial-settings";
import {
  createProformaInvoiceSnapshot,
  PiValidationError,
  piSha256,
  piUtcInstant,
  publicPiPaymentInstructions,
  type PiConditions,
  type ProformaInvoiceSnapshot,
} from "../domain/proforma-invoice";
import { renderProformaInvoicePdf } from "../domain/proforma-invoice-pdf";
import {
  createD1ProformaInvoiceRepository,
  type PiIntentRow,
  type PiRow,
} from "../infrastructure/d1-proforma-invoice-repository";

export interface IssueProformaInvoiceCommand {
  requestId: string;
  commandId: string;
  quoteRevisionId: string;
  quoteRevisionHash: string;
  sellerIdentityId: string;
  sellerVersion: number;
  paymentChannel: PaymentChannel;
  paymentInstructionId: string;
  paymentInstructionVersion: number;
  validUntil?: string;
}

export interface ProformaInvoiceServiceOptions {
  // Trusted server configuration, never arbitrary form policy text. No defaults.
  conditions?:
    PiConditions | ((revision: QuoteRevisionSnapshot) => PiConditions);
  now?: () => Date;
  renderPdf?: typeof renderProformaInvoicePdf;
}

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

export function createProformaInvoiceService(
  db: D1Database,
  privateBucket: R2Bucket,
  options: ProformaInvoiceServiceOptions = {},
) {
  const repository = createD1ProformaInvoiceRepository(db);
  const now = () => piUtcInstant((options.now?.() ?? new Date()).toISOString());
  const render = options.renderPdf ?? renderProformaInvoicePdf;

  async function publicRecord(row: PiRow, includePaymentInstructions = true) {
    if ((await sha(row.snapshot_json)) !== row.snapshot_hash)
      throw new Response("PI snapshot integrity failure", { status: 409 });
    const snapshot = JSON.parse(row.snapshot_json) as ProformaInvoiceSnapshot;
    const currentPayment = includePaymentInstructions
      ? await repository.currentPayment(row.payment_channel)
      : null;
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

  async function customerPaymentActionable(row: PiRow) {
    return !!(await db
      .prepare(
        `SELECT h.pi_id FROM proforma_invoice_heads h
      WHERE h.request_id=? AND h.pi_id=? AND (
        EXISTS(SELECT 1 FROM pi_acceptances a WHERE a.pi_id=h.pi_id)
        OR (? > ? AND ?=(SELECT id FROM quote_revisions WHERE request_id=h.request_id ORDER BY revision_number DESC LIMIT 1)))`,
      )
      .bind(
        row.request_id,
        row.id,
        row.valid_until,
        now(),
        row.quote_revision_id,
      )
      .first());
  }

  async function customerRecord(row: PiRow) {
    const record = await publicRecord(
      row,
      await customerPaymentActionable(row),
    );
    // Rendering the projection may yield while a replacement publishes.
    if (record.paymentInstructions && !(await customerPaymentActionable(row)))
      record.paymentInstructions = null;
    return record;
  }

  async function bytes(row: PiRow, disposition: "inline" | "attachment") {
    const object = await privateBucket.get(row.pdf_object_key);
    if (!object) throw new Response("PI PDF unavailable", { status: 404 });
    if (object.size !== row.pdf_byte_size)
      throw new Response("PI PDF integrity failure", { status: 409 });
    const body = await object.arrayBuffer();
    if ((await piSha256(new Uint8Array(body))) !== row.pdf_sha256)
      throw new Response("PI PDF integrity failure", { status: 409 });
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${row.document_number}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  async function completeIntent(intent: PiIntentRow) {
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
      throw new PiValidationError("PI validity deadline must be in the future");
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
      throw new PiValidationError("PI validity deadline must be in the future");
    try {
      await repository.publish(intent, {
        objectKey,
        sha256: pdf.sha256,
        byteSize: pdf.bytes.byteLength,
        pageCount: pdf.pageCount,
        rendererVersion: pdf.rendererVersion,
      });
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
  }

  async function reserveIntent(
    actor: AdminIdentity,
    input: IssueProformaInvoiceCommand,
  ): Promise<PiIntentRow> {
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
    for (const value of [input.sellerVersion, input.paymentInstructionVersion])
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
      if (await repository.current(input.requestId)) throw conflict();
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
      const revision = JSON.parse(quote.snapshot_json) as QuoteRevisionSnapshot;
      if (revision.requestId !== input.requestId)
        throw new Response("Quote source mismatch", { status: 409 });
      const conditions = options.conditions
        ? structuredClone(
            typeof options.conditions === "function"
              ? options.conditions(structuredClone(revision))
              : options.conditions,
          )
        : undefined;
      if (!conditions)
        throw new PiValidationError(
          "Explicit versioned PI conditions configuration required",
        );
      const id = `pi-${await sha(commandId)}`;
      const snapshot = createProformaInvoiceSnapshot({
        documentNumber: `PI-${id.slice(3, 27).toUpperCase()}`,
        documentVersion: 1,
        issuedAt: now(),
        validUntil: input.validUntil,
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
      try {
        await repository.reserve(proposed);
      } catch (error) {
        const saved = await repository.intent(commandId);
        if (!saved) throw error;
        check(saved);
      }
      intent = check((await repository.intent(commandId))!);
    }
    return intent;
  }

  return {
    async retryPdf(actor: AdminIdentity, requestId: string, commandId: string) {
      admin(actor);
      const timestamp = now();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE proforma_invoice_pdf_jobs SET state='pending',attempts=0,next_attempt_at=?,lease_token=NULL,lease_until=NULL
         WHERE command_id=? AND state='failed' AND EXISTS
           (SELECT 1 FROM proforma_invoice_intents i WHERE i.command_id=proforma_invoice_pdf_jobs.command_id AND i.request_id=?)`,
          )
          .bind(timestamp, commandId, requestId),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
           SELECT ?,'proforma_invoice.pdf_retry','proforma_invoice',i.id,?,'{}',?
           FROM proforma_invoice_intents i WHERE i.command_id=? AND changes()=1`,
          )
          .bind(crypto.randomUUID(), actor.id, timestamp, commandId),
      ]);
      if (results[0].meta.changes !== 1) throw conflict();
    },
    async reserve(actor: AdminIdentity, input: IssueProformaInvoiceCommand) {
      const intent = await reserveIntent(actor, input);
      return { commandId: intent.command_id, piId: intent.id };
    },
    // Internal queue entry point. Never expose this as an unauthenticated route.
    async renderReserved(commandId: string) {
      const intent = await repository.intent(commandId);
      if (!intent) throw new Response("PI intent not found", { status: 404 });
      if ((await sha(intent.snapshot_json)) !== intent.snapshot_hash)
        throw new Response("PI intent integrity failure", { status: 409 });
      return completeIntent(intent);
    },
    async readiness(actor: AdminIdentity, requestId: string) {
      admin(actor);
      const revision = await repository.currentQuote(requestId);
      const seller = await repository.currentSeller();
      const payments = [];
      for (const channel of ["bank_transfer", "paypal"] as const) {
        const payment = await repository.currentPayment(channel);
        if (payment) {
          try {
            payments.push(publicPiPaymentInstructions(payment, channel));
          } catch {
            /* Invalid unused channels do not block a valid selection. */
          }
        }
      }
      return {
        pdfJobs: (
          await db
            .prepare(
              `SELECT j.command_id AS commandId,j.state,j.attempts FROM proforma_invoice_pdf_jobs j
           JOIN proforma_invoice_intents i ON i.command_id=j.command_id
           WHERE i.request_id=? AND j.state<>'completed' ORDER BY i.issued_at DESC`,
            )
            .bind(requestId)
            .all<{ commandId: string; state: string; attempts: number }>()
        ).results,
        quoteRevision: revision
          ? { id: revision.id, hash: revision.snapshot_hash }
          : null,
        seller,
        payments,
        conditionsConfigured: !!options.conditions,
        current: await repository
          .current(requestId)
          .then((row) => (row ? publicRecord(row) : null)),
      };
    },

    async issue(actor: AdminIdentity, input: IssueProformaInvoiceCommand) {
      return completeIntent(await reserveIntent(actor, input));
    },

    async adminCurrent(actor: AdminIdentity, requestId: string) {
      admin(actor);
      const row = await repository.current(requestId);
      return row ? publicRecord(row) : null;
    },
    async adminRead(actor: AdminIdentity, requestId: string, piId: string) {
      admin(actor);
      const row = await repository.byId(requestId, piId);
      if (!row) throw new Response("Not found", { status: 404 });
      return publicRecord(row);
    },
    async customerCurrent(profileId: string, requestId: string) {
      customer(profileId);
      await repository.requireOwnedQuote(profileId, requestId);
      const row = await repository.owned(profileId, requestId);
      return row ? customerRecord(row) : null;
    },
    async customerRead(profileId: string, requestId: string, piId: string) {
      customer(profileId);
      const row = await repository.owned(profileId, requestId, piId);
      if (!row) throw new Response("Not found", { status: 404 });
      return customerRecord(row);
    },
    async customerDownload(
      profileId: string,
      requestId: string,
      piId: string,
      disposition: "inline" | "attachment" = "attachment",
    ) {
      customer(profileId);
      const row = await repository.owned(profileId, requestId, piId);
      if (!row) throw new Response("Not found", { status: 404 });
      const response = await bytes(row, disposition);
      await repository.requireOwnedQuote(profileId, requestId);
      return response;
    },
    async adminDownload(
      actor: AdminIdentity,
      requestId: string,
      piId: string,
      disposition: "inline" | "attachment" = "attachment",
    ) {
      admin(actor);
      const row = await repository.byId(requestId, piId);
      if (!row) throw new Response("Not found", { status: 404 });
      return bytes(row, disposition);
    },
  };
}
