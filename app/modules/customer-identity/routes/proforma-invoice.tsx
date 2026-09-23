import { Link, data, type LoaderFunctionArgs } from "react-router";
import { ArrowLeft, Download, Eye } from "lucide-react";
import { cloudflareContext } from "#workers/context";
import { piAcceptance, type PiAcceptanceStatus } from "#workers/pi-acceptance";
import {
  proformaInvoices,
  piCustomerProfile,
  piPrivateHeaders,
  piRouteId,
  type PiRecord,
  piLifecycle,
  piPayments,
} from "#workers/proforma-invoice";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import { AccountWorkspace } from "../ui/account-workspace";
import { CustomerQuoteNavigation } from "../ui/customer-quote-navigation";
import {
  PiLifecycleHistory,
  type PiLifecycleHistoryItem,
} from "../../proforma-invoice/ui/pi-lifecycle-history";

export const headers = piPrivateHeaders;
export function meta() {
  return [{ title: "Proforma Invoice | My Quotes" }];
}
export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareContext);
  const profileId = await piCustomerProfile(env, request);
  const requestId = piRouteId(params.requestId);
  const service = proformaInvoices(env);
  const invoice = params.piId
    ? await service.customerRead(profileId, requestId, piRouteId(params.piId))
    : await service.customerCurrent(profileId, requestId);
  const status = invoice
    ? await piAcceptance(env).customerStatus(profileId, requestId, invoice.id)
    : null;
  const payment = invoice
    ? await piPayments(env).customerRead(profileId, requestId, invoice.id)
    : null;
  const history = invoice
    ? await piLifecycle(env).customerHistory(profileId, requestId)
    : [];
  const latest = history.find(
    (record) =>
      record.id === invoice?.id && record.snapshotHash === invoice.snapshotHash,
  )?.lifecycle;
  // Status/history reads may observe a replacement after the invoice read.
  const safeInvoice =
    invoice &&
    !(latest?.isCurrent && (latest.state === "accepted" || latest.canAccept))
      ? { ...invoice, paymentInstructions: null }
      : invoice;
  return data(
    { requestId, invoice: safeInvoice, status, history, payment },
    { headers: headers() },
  );
}

export default function ProformaInvoice({
  loaderData,
}: {
  loaderData: {
    requestId: string;
    invoice: PiRecord | null;
    status?: PiAcceptanceStatus | null;
    history?: PiLifecycleHistoryItem[];
    payment?: Awaited<
      ReturnType<ReturnType<typeof piPayments>["customerRead"]>
    > | null;
  };
}) {
  const { requestId, invoice, status, history = [], payment } = loaderData;
  const lifecycle = history.find(
    (record) => record.id === invoice?.id,
  )?.lifecycle;
  const base = `/account/quotes/${encodeURIComponent(requestId)}`;
  const snapshot = invoice?.snapshot;
  const showPaymentInstructions = lifecycle
    ? lifecycle.isCurrent &&
      (lifecycle.state === "accepted" || lifecycle.canAccept)
    : status?.current && (!!status.acceptance || !status.expired);
  const target =
    status?.current &&
    !status.expired &&
    snapshot &&
    (!lifecycle || lifecycle.canAccept)
      ? `&${new URLSearchParams({ documentVersion: String(snapshot.documentVersion), snapshotHash: invoice.snapshotHash })}`
      : "";
  return (
    <AccountWorkspace activeView="my-quotes">
      <main
        className="customer-quote-detail account-detail-content"
        style={{ minWidth: 0, overflowWrap: "anywhere" }}
      >
        <Link className="customer-quote-back-link" to={base}>
          <ArrowLeft size={17} />
          Back to quote
        </Link>
        <h1>Proforma invoice</h1>
        <CustomerQuoteNavigation requestId={requestId} />
        {!invoice || !snapshot ? (
          <p>No proforma invoice has been issued for this quote.</p>
        ) : (
          <>
            <header className="customer-quote-detail-header">
              <div>
                <h2>{snapshot.documentNumber}</h2>
                <p>
                  Version {snapshot.documentVersion} · Quote revision{" "}
                  {snapshot.quoteRevision.number}
                </p>
                {lifecycle && (
                  <p>
                    <strong>{lifecycle.label}</strong>
                  </p>
                )}
              </div>
            </header>
            <dl className="customer-quote-summary">
              <div>
                <dt>Issued (ET)</dt>
                <dd>{formatPiDate(snapshot.issuedAt, "customer")}</dd>
              </div>
              <div>
                <dt>Valid until (ET)</dt>
                <dd>{formatPiDate(snapshot.validUntil, "customer")}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>USD {(snapshot.totals.totalCents / 100).toFixed(2)}</dd>
              </div>
            </dl>
            {payment && (
              <section className="customer-quote-section">
                <h2>Payment progress</h2>
                <dl className="customer-quote-summary">
                  <div>
                    <dt>Total due</dt>
                    <dd>USD {(payment.totalDueCents / 100).toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>
                      {payment.paymentConfirmed
                        ? "Payment confirmed"
                        : "Received, pending confirmation"}
                    </dt>
                    <dd>
                      {payment.receiptHistoryKnown
                        ? `USD ${(Math.min(payment.amountReceivedCents, payment.totalDueCents) / 100).toFixed(2)}`
                        : "Historical balance under review"}
                    </dd>
                  </div>
                  <div>
                    <dt>Remaining balance</dt>
                    <dd>
                      {payment.receiptHistoryKnown
                        ? `USD ${(payment.balanceCents / 100).toFixed(2)}`
                        : "Contact Support"}
                    </dd>
                  </div>
                  {payment.excessCents > 0 && (
                    <div>
                      <dt>Excess under review</dt>
                      <dd>USD {(payment.excessCents / 100).toFixed(2)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Payment due (ET)</dt>
                    <dd>
                      {payment.dueAt
                        ? formatPiDate(payment.dueAt, "customer")
                        : payment.termKind === "legacy_review"
                          ? "Please contact Support to confirm historical payment terms"
                          : "10 US bank business days after acceptance"}
                    </dd>
                  </div>
                </dl>
                {payment.orderId && (
                  <Link
                    className="button button-primary"
                    to={`/account/orders/${encodeURIComponent(payment.orderId)}`}
                  >
                    View confirmed order
                  </Link>
                )}
              </section>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <a
                className="button button-secondary"
                href={`${base}/pi/${encodeURIComponent(invoice.id)}/pdf?disposition=inline${target}`}
                target="_blank"
                rel="noreferrer"
              >
                <Eye size={18} />
                View PI
              </a>
              <a
                className="button button-secondary"
                href={`${base}/pi/${encodeURIComponent(invoice.id)}/pdf${target ? `?${target.slice(1)}` : ""}`}
              >
                <Download size={18} />
                Download PI
              </a>
            </div>
            {status && (
              <section className="customer-quote-section">
                <h2>
                  {lifecycle?.state === "superseded"
                    ? "PI Superseded"
                    : status.acceptance
                      ? "PI Accepted"
                      : !status.current
                        ? "Previous PI"
                        : status.expired
                          ? "PI Expired"
                          : "PI Ready"}
                </h2>
                {lifecycle?.awaitingReplacement && <p>Updated PI pending</p>}
                {(status.acceptance ||
                  (status.current &&
                    !status.expired &&
                    (!lifecycle || lifecycle.canAccept))) && (
                  <Link
                    className="button button-primary"
                    to={`${base}/pi/${encodeURIComponent(invoice.id)}/accept`}
                  >
                    {status.acceptance
                      ? "Acceptance record"
                      : "Review and accept PI"}
                  </Link>
                )}
              </section>
            )}
            {showPaymentInstructions && (
              <section className="customer-quote-section">
                <h2>Payment instructions</h2>
                {invoice.paymentInstructions ? (
                  <>
                    <p>
                      {invoice.paymentInstructions.channel === "paypal"
                        ? "PayPal"
                        : "Bank Transfer"}{" "}
                      · Version {invoice.paymentInstructions.version}
                    </p>
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {invoice.paymentInstructions.instructions}
                    </p>
                  </>
                ) : (
                  <p role="alert">
                    Current payment instructions are unavailable. Contact
                    Support before sending payment.
                  </p>
                )}
              </section>
            )}
            <section className="customer-quote-section">
              <h2>Seller</h2>
              <p>{snapshot.seller.legalName}</p>
              <address style={{ whiteSpace: "pre-wrap" }}>
                {snapshot.seller.registeredAddressEn}
              </address>
            </section>
          </>
        )}
        <PiLifecycleHistory records={history} />
      </main>
    </AccountWorkspace>
  );
}
