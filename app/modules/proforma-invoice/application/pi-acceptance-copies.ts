import type { AdminIdentity } from "#workers/admin-access";
import { requireReviewMutation } from "../../quote-review/domain/private-review";
import {
  createResendNotificationAdapter,
  type NotificationEmail,
  type NotificationEnvironment,
  type NotificationProtector,
  type QuoteNotificationAdapter,
  type NotificationQueueMessage,
} from "../../quote-notifications";
import {
  notificationConfiguration,
  normalizeReplySender,
  retryDelaySeconds,
  SAFE_PROVIDER_RETRY_MS,
  MAX_DELIVERY_ATTEMPTS,
} from "../../quote-notifications/domain/quote-notification";
import { createD1PiAcceptanceCopies } from "../infrastructure/d1-pi-acceptance-copies";
import {
  formatPiDate,
  piSha256,
  type ProformaInvoiceSnapshot,
} from "../domain/proforma-invoice";
import type { PiAcceptance } from "../domain/pi-acceptance";

export interface PiAcceptanceCopyJob {
  type: "pi-acceptance-copy";
  acceptanceId: string;
}
export interface ReconcilePiAcceptanceCopyInput {
  commandId: string;
  acceptanceId: string;
  generation: number;
  outcome: "delivered" | "confirmed_not_delivered";
  providerId?: string;
  reference: string;
  reason: string;
  explicitlyConfirmed: boolean;
}
function admin(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}
function limit(value = 50) {
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(100, value)) : 50;
}
const context = (id: string) => `pi-acceptance-copy:${id}`;

export function createPiAcceptanceCopies(input: {
  database: D1Database;
  env: NotificationEnvironment;
  protector: NotificationProtector;
  adapter?: QuoteNotificationAdapter;
  now?: () => number;
}) {
  const repository = createD1PiAcceptanceCopies(input.database);
  const now = input.now ?? Date.now;
  async function deliver(id: string) {
    let row = await repository.claim(id, now(), crypto.randomUUID());
    if (!row) return;
    if (
      row.attempts >= MAX_DELIVERY_ATTEMPTS ||
      (row.first_attempt_at !== null &&
        now() >= row.first_attempt_at + SAFE_PROVIDER_RETRY_MS)
    ) {
      await repository.finish(
        row,
        "review",
        "delivery_budget_exhausted",
        now(),
      );
      return;
    }
    let adapter = input.adapter;
    try {
      notificationConfiguration(input.env);
      if (input.env.EMAIL_DELIVERY_MODE === "resend" && !adapter)
        adapter = createResendNotificationAdapter(
          (input.env.APP_ENV === "preview"
            ? input.env.PREVIEW_RESEND_API_KEY
            : input.env.PRODUCTION_RESEND_API_KEY) ?? "",
        );
    } catch {
      await repository.finish(
        row,
        "review",
        "configuration_unavailable",
        now(),
      );
      return;
    }
    if (
      row.delivery_mode &&
      row.delivery_mode !== input.env.EMAIL_DELIVERY_MODE
    ) {
      await repository.finish(row, "review", "delivery_mode_changed", now());
      return;
    }
    if (
      !normalizeReplySender(row.recipient_email) ||
      !(await repository.authorized(row))
    ) {
      await repository.finish(
        row,
        "review",
        "recipient_no_longer_authorized",
        now(),
      );
      return;
    }
    if (!row.protected_payload) {
      try {
        const source = await repository.source(row);
        if (
          !source ||
          (await piSha256(new TextEncoder().encode(source.snapshot_json))) !==
            source.snapshot_hash
        ) {
          await repository.finish(
            row,
            "review",
            "acceptance_source_unavailable",
            now(),
          );
          return;
        }
        const acceptance = JSON.parse(source.evidence_json) as PiAcceptance;
        const pi = JSON.parse(source.snapshot_json) as ProformaInvoiceSnapshot;
        if (
          acceptance.snapshotHash !== source.snapshot_hash ||
          acceptance.piId !== source.pi_id ||
          acceptance.documentVersion !== source.document_version ||
          acceptance.customer.profileId !== row.recipient_profile_id ||
          acceptance.evidence.source !== source.source ||
          pi.documentVersion !== source.document_version ||
          pi.documentNumber !== source.document_number ||
          !source.document_number ||
          source.document_number.length > 200 ||
          /[\r\n]/.test(source.document_number)
        ) {
          await repository.finish(
            row,
            "review",
            "acceptance_source_mismatch",
            now(),
          );
          return;
        }
        const general = acceptance.acknowledgements.general;
        const text = [
          "PI acceptance confirmation",
          `PI: ${source.document_number}`,
          `PI ID: ${acceptance.piId}`,
          `Document version: ${acceptance.documentVersion}`,
          `Snapshot SHA-256: ${acceptance.snapshotHash}`,
          `Accepted by: ${acceptance.legalName}`,
          `Recorded at: ${formatPiDate(acceptance.acceptedAt, "customer")}`,
          `Acceptance source: ${acceptance.evidence.source === "email" ? "Customer email, explicitly reviewed by our team" : "Customer website confirmation"}`,
          "",
          `General commercial acknowledgement (${general.version}):`,
          general.text,
          ...acceptance.acknowledgements.madeToOrder.flatMap((ack) => {
            const line = pi.lines.find((value) => value.id === ack.lineId);
            return [
              "",
              `Made-to-order line ${ack.lineId}${line?.sku ? ` (${line.sku})` : ""} (${ack.version}):`,
              ack.text,
              `Specifications explicitly confirmed. Cancellation conditions explicitly confirmed (${ack.cancellationVersion}).`,
            ];
          }),
          "",
          `Cancellation conditions (${acceptance.conditions.cancellation.version}):`,
          acceptance.conditions.cancellation.text,
          "",
          `Refund conditions (${acceptance.conditions.refund.version}):`,
          acceptance.conditions.refund.text,
          "",
          "This copy records acceptance only. It is not confirmation of payment, an Order, or authorization to start production.",
          "The accepted PI and acceptance record remain available in My Quotes.",
        ].join("\n");
        const email: NotificationEmail = {
          from: input.env.EMAIL_FROM,
          to: [row.recipient_email],
          subject: `PI acceptance confirmation - ${source.document_number}`,
          text,
          reply_to: normalizeReplySender(
            input.env.EMAIL_FROM.match(/<([^<>]+)>$/)?.[1] ??
              input.env.EMAIL_FROM,
          )!,
        };
        try {
          const payload = await input.protector.seal(
            JSON.stringify(email),
            context(row.id),
          );
          const prepared = await repository.prepare(
            row,
            payload,
            input.env.EMAIL_DELIVERY_MODE,
            now(),
          );
          if (!prepared) return;
          row = prepared;
        } catch {
          await repository.finish(
            row,
            "review",
            "protected_payload_unavailable",
            now(),
          );
          return;
        }
      } catch {
        await repository.finish(
          row,
          "review",
          "acceptance_source_mismatch",
          now(),
        );
        return;
      }
    }
    let email: NotificationEmail;
    try {
      email = JSON.parse(
        await input.protector.open(row.protected_payload!, context(row.id)),
      );
      if (
        !email ||
        !Array.isArray(email.to) ||
        email.to.length !== 1 ||
        email.to[0] !== row.recipient_email ||
        typeof email.text !== "string" ||
        typeof email.subject !== "string" ||
        /[\r\n]/.test(email.subject)
      )
        throw new Error("Copy payload mismatch");
    } catch {
      await repository.finish(
        row,
        "review",
        "protected_payload_unavailable",
        now(),
      );
      return;
    }
    if (!(await repository.authorized(row))) {
      await repository.finish(
        row,
        "review",
        "recipient_no_longer_authorized",
        now(),
      );
      return;
    }
    const attempt = await repository.attempt(row, now());
    if (!attempt) return;
    row = attempt;
    if (input.env.EMAIL_DELIVERY_MODE === "stub") {
      await repository.capture(row, now());
      return;
    }
    let result;
    try {
      const key = `pi-acceptance-copy/${row.id}${row.generation > 1 ? `/generation/${row.generation}` : ""}`;
      result = await adapter!.send(email, key);
    } catch {
      result = { kind: "retry" as const, code: "transport_uncertain" };
    }
    if (result.kind === "sent") {
      await repository.finish(row, "sent", null, now(), result.providerId);
      return;
    }
    if (result.kind === "permanent" || result.kind === "review") {
      await repository.finish(
        row,
        result.kind === "permanent" ? "dead_letter" : "review",
        result.code,
        now(),
      );
      return;
    }
    const requestedDelay =
      "retryAfterSeconds" in result && Number.isFinite(result.retryAfterSeconds)
        ? Number(result.retryAfterSeconds)
        : 0;
    const delay = Math.max(
      retryDelaySeconds(row.attempts),
      Math.min(3600, Math.max(0, requestedDelay)),
    );
    if (
      row.attempts >= MAX_DELIVERY_ATTEMPTS ||
      now() + delay * 1000 >= row.first_attempt_at! + SAFE_PROVIDER_RETRY_MS
    ) {
      await repository.finish(
        row,
        "review",
        "delivery_budget_exhausted",
        now(),
      );
      return;
    }
    await repository.retry(row, result.code, now() + delay * 1000);
  }
  return {
    async reconcileAdmin(
      actor: AdminIdentity,
      request: Request,
      value: ReconcilePiAcceptanceCopyInput,
    ) {
      admin(actor);
      requireReviewMutation(request);
      const required = (value: unknown, label: string, max = 2000) => {
        if (
          typeof value !== "string" ||
          !value.trim() ||
          value.length > max ||
          [...value].some((character) => character.charCodeAt(0) < 32)
        )
          throw new Response(`${label} required`, { status: 400 });
        return value.trim();
      };
      if (
        !value ||
        value.explicitlyConfirmed !== true ||
        !Number.isSafeInteger(value.generation) ||
        value.generation < 1 ||
        !["delivered", "confirmed_not_delivered"].includes(value.outcome) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          value.commandId,
        )
      )
        throw new Response("Explicit provider reconciliation required", {
          status: 400,
        });
      const input = {
        acceptanceId: required(value.acceptanceId, "Acceptance id", 200),
        generation: value.generation,
        outcome: value.outcome,
        providerId:
          value.outcome === "delivered"
            ? required(value.providerId, "Provider delivery id", 500)
            : null,
        reference: required(value.reference, "Provider evidence reference"),
        reason: required(value.reason, "Reconciliation reason"),
        actorId: actor.id,
      };
      const commandHash = await piSha256(
        new TextEncoder().encode(JSON.stringify(input)),
      );
      const commandId = value.commandId.toLowerCase();
      const replay = async () => {
        const saved = await repository.reconciliation(commandId);
        if (
          saved &&
          (saved.command_hash !== commandHash ||
            saved.acceptance_id !== input.acceptanceId)
        )
          throw new Response("Reconciliation command conflict", {
            status: 409,
          });
        return !!saved;
      };
      if (await replay()) return;
      try {
        await repository.reconcile({
          ...input,
          commandId,
          commandHash,
          now: now(),
        });
      } catch (error) {
        if (await replay()) return;
        throw error;
      }
      if (!(await replay()))
        throw new Response("Copy generation or state changed", { status: 409 });
    },
    async dispatch(
      queue: { send(job: PiAcceptanceCopyJob): Promise<unknown> },
      count = 50,
    ) {
      let enqueued = 0,
        failed = 0;
      for (const candidate of await repository.due(now(), limit(count))) {
        const row = await repository.dispatchClaim(candidate, now());
        if (!row) continue;
        try {
          await queue.send({
            type: "pi-acceptance-copy",
            acceptanceId: row.id,
          });
          await repository.dispatched(row);
          enqueued++;
        } catch {
          await repository.dispatchFailed(
            row,
            now(),
            retryDelaySeconds(row.dispatch_attempts),
          );
          failed++;
        }
      }
      return { enqueued, failed };
    },
    async consume(message: NotificationQueueMessage) {
      const job = message.body as Partial<PiAcceptanceCopyJob> | null;
      if (
        !job ||
        job.type !== "pi-acceptance-copy" ||
        typeof job.acceptanceId !== "string" ||
        !job.acceptanceId ||
        job.acceptanceId.length > 200
      )
        return false;
      try {
        await deliver(job.acceptanceId);
        const row = await repository.read(job.acceptanceId);
        if (row && ["pending", "sending", "retry"].includes(row.state))
          message.retry({
            delaySeconds: Math.min(
              43200,
              Math.max(
                1,
                Math.ceil(
                  (Math.max(row.next_attempt_at, row.lease_until ?? 0) -
                    now()) /
                    1000,
                ),
              ),
            ),
          });
        else message.ack();
      } catch {
        message.retry({ delaySeconds: 60 });
      }
      return true;
    },
    async listAdmin(
      actor: AdminIdentity,
      options: { limit?: number; unresolved?: boolean; before?: string } = {},
    ) {
      admin(actor);
      if (options.before && options.before.length > 200)
        throw new Response("Invalid cursor", { status: 400 });
      const page = await repository.list(
        limit(options.limit),
        options.unresolved === true,
        options.before,
      );
      return {
        ...page,
        rows: page.rows.map((row) => ({
          ...row,
          canRetry:
            ["review", "dead_letter"].includes(row.state) &&
            row.attempts < MAX_DELIVERY_ATTEMPTS &&
            (row.first_attempt_at === null ||
              row.first_attempt_at > now() - SAFE_PROVIDER_RETRY_MS),
        })),
      };
    },
    async retryAdmin(
      actor: AdminIdentity,
      request: Request,
      acceptanceId: string,
      reason: string,
    ) {
      admin(actor);
      requireReviewMutation(request);
      if (
        typeof acceptanceId !== "string" ||
        !acceptanceId.trim() ||
        acceptanceId.length > 200
      )
        throw new Response("Acceptance id required", { status: 400 });
      if (typeof reason !== "string" || !reason.trim() || reason.length > 2000)
        throw new Response("Retry reason required", { status: 400 });
      if (
        !(await repository.retryAdmin(
          acceptanceId,
          actor.id,
          reason.trim(),
          now(),
        ))
      )
        throw new Response("Provider reconciliation required before retry", {
          status: 409,
        });
    },
    async readLocalCapture(
      actor: AdminIdentity,
      acceptanceId: string,
    ): Promise<NotificationEmail> {
      admin(actor);
      if (
        input.env.APP_ENV !== "local" ||
        input.env.EMAIL_DELIVERY_MODE !== "stub"
      )
        throw new Response("Not found", { status: 404 });
      const row = await repository.capturePayload(acceptanceId);
      if (!row) throw new Response("Not found", { status: 404 });
      return JSON.parse(
        await input.protector.open(
          row.protected_payload,
          context(acceptanceId),
        ),
      );
    },
  };
}
