import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../domain/proforma-invoice";

function admin(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}
const conflict = () =>
  new Response("PI 或报价版本已变化，请刷新后重新核对。", { status: 409 });
const hash = (value: string) => piSha256(new TextEncoder().encode(value));

export function createPiAcceptedAgreementService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string } = {},
) {
  async function readiness(actor: AdminIdentity, piId: string) {
    admin(actor);
    const row = await db
      .prepare(
        `SELECT p.id AS piId,p.document_number AS documentNumber,
      p.document_version AS documentVersion,p.snapshot_hash AS snapshotHash,
      p.snapshot_json AS snapshotJson,p.quote_revision_id AS quoteRevisionId,
      h.pi_id AS currentPiId,h.version AS headVersion,a.id AS acceptanceId,a.accepted_at AS acceptedAt,
      a.snapshot_hash AS acceptanceHash,a.document_version AS acceptanceVersion,
      pay.version AS paymentVersion,pay.term_kind AS termKind,pay.due_at AS dueAt,
      (SELECT id FROM quote_revisions WHERE request_id=p.request_id ORDER BY revision_number DESC LIMIT 1) AS latestQuoteRevisionId,
      EXISTS(SELECT 1 FROM confirmed_orders WHERE request_id=p.request_id) AS hasOrder,
      EXISTS(SELECT 1 FROM pi_payment_disputes WHERE pi_id=p.id AND active=1) AS disputed,
      EXISTS(SELECT 1 FROM retained_pi_agreements WHERE pi_id=p.id) AS retained
      FROM proforma_invoices p JOIN proforma_invoice_heads h ON h.request_id=p.request_id
      JOIN pi_payment_accounts pay ON pay.pi_id=p.id LEFT JOIN pi_acceptances a ON a.pi_id=p.id
      WHERE p.id=?`,
      )
      .bind(piId)
      .first<{
        piId: string;
        documentNumber: string;
        documentVersion: number;
        snapshotHash: string;
        snapshotJson: string;
        quoteRevisionId: string;
        currentPiId: string;
        headVersion: number;
        acceptanceId: string | null;
        acceptedAt: string | null;
        acceptanceHash: string | null;
        acceptanceVersion: number | null;
        paymentVersion: number;
        termKind: string;
        dueAt: string | null;
        latestQuoteRevisionId: string;
        hasOrder: number;
        disputed: number;
        retained: number;
      }>();
    if (!row) throw new Response("PI not found", { status: 404 });
    const snapshot = JSON.parse(row.snapshotJson);
    const noPaymentDeadline =
      row.termKind === "legacy_review" &&
      snapshot.paymentTerms == null &&
      row.dueAt === null;
    const blockedReason =
      row.currentPiId !== piId
        ? "该 PI 已被替换，不能恢复为当前协议。"
        : !row.acceptanceId
          ? "客户尚未接受该 PI。"
          : row.hasOrder
            ? "订单已生成，订单协议已固定。"
            : row.disputed
              ? "请先完成付款更正的放行审核。"
              : row.retained
                ? "已确认以客户接受的 PI 为准。"
                : row.termKind === "legacy_review" && !noPaymentDeadline
                  ? "原付款条款需要进一步核对。"
                  : row.acceptanceHash !== row.snapshotHash ||
                      row.acceptanceVersion !== row.documentVersion ||
                      (await hash(row.snapshotJson)) !== row.snapshotHash
                    ? "PI 与客户接受记录不一致。"
                    : null;
    return {
      piId,
      documentNumber: row.documentNumber,
      documentVersion: row.documentVersion,
      snapshotHash: row.snapshotHash,
      headVersion: row.headVersion,
      acceptanceId: row.acceptanceId,
      acceptedAt: row.acceptedAt,
      paymentVersion: row.paymentVersion,
      latestQuoteRevisionId: row.latestQuoteRevisionId,
      hasNewerQuote: row.latestQuoteRevisionId !== row.quoteRevisionId,
      noPaymentDeadline,
      retained: Boolean(row.retained),
      blockedReason,
    };
  }
  return {
    readiness,
    async retain(
      actor: AdminIdentity,
      input: {
        piId: string;
        commandId: string;
        expectedVersion: number;
        expectedHeadVersion: number;
        acceptanceId: string;
        documentVersion: number;
        snapshotHash: string;
        latestQuoteRevisionId: string;
        reviewed: boolean;
        noPaymentDeadline: boolean;
        reason: string;
      },
    ) {
      admin(actor);
      if (
        !/^[0-9a-f-]{36}$/i.test(input.commandId) ||
        input.reviewed !== true ||
        !input.reason?.trim() ||
        input.reason.trim().length > 1000
      )
        throw new Response("请确认客户接受的 PI 并填写保留原因。", {
          status: 400,
        });
      const commandHash = await hash(
        JSON.stringify({
          ...input,
          reason: input.reason.trim(),
          actorId: actor.id,
        }),
      );
      const previous = await db
        .prepare(
          "SELECT command_hash FROM pi_accepted_agreement_reviews WHERE command_id=?",
        )
        .bind(input.commandId)
        .first<{ command_hash: string }>();
      if (previous) {
        if (previous.command_hash !== commandHash) throw conflict();
        return { retained: true as const };
      }
      const ready = await readiness(actor, input.piId);
      if (
        ready.blockedReason ||
        ready.paymentVersion !== input.expectedVersion ||
        ready.headVersion !== input.expectedHeadVersion ||
        ready.acceptanceId !== input.acceptanceId ||
        ready.documentVersion !== input.documentVersion ||
        ready.snapshotHash !== input.snapshotHash ||
        ready.latestQuoteRevisionId !== input.latestQuoteRevisionId ||
        ready.noPaymentDeadline !== input.noPaymentDeadline
      )
        throw conflict();
      const id = crypto.randomUUID();
      const timestamp = (options.now?.() ?? new Date()).toISOString();
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO pi_accepted_agreement_reviews(id,command_id,command_hash,pi_id,
            acceptance_id,document_version,snapshot_hash,reviewed_quote_revision_id,expected_head_version,
            expected_payment_version,no_payment_deadline,reason,actor_id,reviewed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              id,
              input.commandId,
              commandHash,
              input.piId,
              input.acceptanceId,
              input.documentVersion,
              input.snapshotHash,
              input.latestQuoteRevisionId,
              input.expectedHeadVersion,
              input.expectedVersion,
              Number(input.noPaymentDeadline),
              input.reason.trim(),
              actor.id,
              timestamp,
            ),
          db
            .prepare(
              "UPDATE pi_payment_accounts SET version=version+1,updated_at=? WHERE pi_id=? AND version=?",
            )
            .bind(timestamp, input.piId, input.expectedVersion),
          // Invalidate an already queued replacement based on the old reviewed head.
          db
            .prepare(
              "UPDATE proforma_invoice_heads SET version=version+1 WHERE pi_id=? AND version=?",
            )
            .bind(input.piId, input.expectedHeadVersion),
          db
            .prepare(
              `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
            VALUES(?,'pi.accepted_agreement_retained','proforma_invoice',?,?,?,?)`,
            )
            .bind(
              `pi-retained:${id}`,
              input.piId,
              actor.id,
              JSON.stringify({
                acceptanceId: input.acceptanceId,
                documentVersion: input.documentVersion,
                snapshotHash: input.snapshotHash,
                reviewedQuoteRevisionId: input.latestQuoteRevisionId,
                noPaymentDeadline: input.noPaymentDeadline,
                reason: input.reason.trim(),
                ipAddress: options.auditIp ?? null,
              }),
              timestamp,
            ),
        ]);
      } catch (error) {
        const replay = await db
          .prepare(
            "SELECT command_hash FROM pi_accepted_agreement_reviews WHERE command_id=?",
          )
          .bind(input.commandId)
          .first<{ command_hash: string }>();
        if (replay?.command_hash === commandHash)
          return { retained: true as const };
        if (String(error).includes("Accepted PI agreement changed"))
          throw conflict();
        throw error;
      }
      return { retained: true as const };
    },
  };
}
