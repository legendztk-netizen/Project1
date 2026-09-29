import { Link, data, type LoaderFunctionArgs } from "react-router";
import { ArrowLeft, Download, Eye, Package } from "lucide-react";
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
import { hoseMediaPath } from "../../storefront/ui/catalog-media";
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

type Snapshot = PiRecord["snapshot"];
type Payment = Awaited<
  ReturnType<ReturnType<typeof piPayments>["customerRead"]>
>;

const usd = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
const chargeLabels: Record<string, string> = {
  freight: "Freight",
  insurance: "Insurance",
  dutiesImport: "Duties and import fees",
  salesTax: "Sales tax",
  cuttingLabeling: "Cutting and labeling",
  assemblyService: "Assembly service",
  protectionService: "Protection service",
};

function lineImage(line: Snapshot["lines"][number]) {
  if (line.assembly) return hoseMediaPath(line.assembly.hose.mediaKey);
  return line.product?.mainImageUrl ?? null;
}

function paymentDueText(payment: Payment) {
  if (!payment) return null;
  return payment.dueAt
    ? formatPiDate(payment.dueAt, "customer")
    : payment.paymentDeadlineUnspecified
      ? "Not specified in the accepted PI"
      : payment.termKind === "legacy_review"
        ? "Contact Support to confirm historical payment terms"
        : "10 US bank business days after acceptance";
}

function PaymentProgress({ payment }: { payment: NonNullable<Payment> }) {
  const paid = payment.receiptHistoryKnown
    ? Math.min(payment.amountReceivedCents, payment.totalDueCents)
    : null;
  const percent =
    paid !== null && payment.totalDueCents > 0
      ? Math.round((paid / payment.totalDueCents) * 100)
      : 0;
  return (
    <section className="customer-quote-section customer-pi-card">
      <div className="customer-pi-card-heading">
        <h2>Payment</h2>
        <span
          className={`customer-order-badge ${payment.paymentConfirmed ? "delivered" : "ready"}`}
        >
          {payment.paymentConfirmed
            ? "Payment confirmed"
            : paid
              ? "Received, pending confirmation"
              : "Awaiting payment"}
        </span>
      </div>
      <div
        className="customer-pi-payment-bar"
        role="progressbar"
        aria-label="Amount paid"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <dl className="customer-pi-facts">
        <div>
          <dt>Total due</dt>
          <dd>{usd(payment.totalDueCents)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>
            {paid !== null ? usd(paid) : "Historical balance under review"}
          </dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>
            {payment.receiptHistoryKnown
              ? usd(payment.balanceCents)
              : "Contact Support"}
          </dd>
        </div>
        <div>
          <dt>Payment due (ET)</dt>
          <dd>{paymentDueText(payment)}</dd>
        </div>
        {payment.excessCents > 0 && (
          <div>
            <dt>Excess under review</dt>
            <dd>{usd(payment.excessCents)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function Parties({ snapshot }: { snapshot: Snapshot }) {
  const buyer = snapshot.buyer;
  const destination = snapshot.destination;
  const buyerName = buyer
    ? buyer.legalName ||
      buyer.tradeName ||
      buyer.contactName ||
      buyer.contactEmail
    : null;
  if (!buyer && !destination) return null;
  return (
    <section className="customer-quote-section customer-pi-card">
      <h2>Buyer and delivery</h2>
      <div className="customer-pi-parties">
        {buyer && (
          <div>
            <h3>Buyer</h3>
            <p className="customer-pi-party-name">{buyerName}</p>
            {buyer.contactEmail && buyer.contactEmail !== buyerName && (
              <p>{buyer.contactEmail}</p>
            )}
            {buyer.registrationOrTaxId && (
              <p>Tax ID {buyer.registrationOrTaxId}</p>
            )}
          </div>
        )}
        {destination && (
          <div>
            <h3>Ship to</h3>
            <p className="customer-pi-party-name">
              {destination.recipientName}
            </p>
            <address>
              {[
                destination.addressLine1,
                destination.addressLine2,
                `${destination.city}, ${destination.stateProvince} ${destination.postalCode}`,
                destination.countryCode,
              ]
                .filter(Boolean)
                .join("\n")}
            </address>
            {destination.recipientPhone && <p>{destination.recipientPhone}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function Items({ snapshot }: { snapshot: Snapshot }) {
  if (!snapshot.lines?.length) return null;
  const charges = Object.entries(snapshot.terms?.charges ?? {}).filter(
    ([, cents]) => typeof cents === "number" && cents !== 0,
  ) as Array<[string, number]>;
  return (
    <section className="customer-quote-section customer-pi-card">
      <h2>Items</h2>
      <ul className="customer-pi-items">
        {snapshot.lines.map((line) => {
          const image = lineImage(line);
          return (
            <li key={line.id}>
              <span className="customer-order-thumb" aria-hidden="true">
                {image ? <img src={image} alt="" /> : <Package size={24} />}
              </span>
              <span className="customer-pi-item-name">
                <strong>{line.displayName}</strong>
                <span>
                  SKU {line.sku}
                  {line.assembly?.finishedLength &&
                    ` · ${line.assembly.finishedLength.originalValue} ${line.assembly.finishedLength.originalUnit} finished length`}
                  {line.lengthOrder &&
                    ` · ${line.lengthOrder.pieceCount} × ${line.lengthOrder.originalLengthValue} ${line.lengthOrder.originalLengthUnit}`}
                </span>
              </span>
              <span className="customer-pi-item-qty">
                {line.quantity} {line.salesUnit} ×{" "}
                {line.price?.unitPriceCents == null
                  ? "Pending"
                  : usd(line.price.unitPriceCents)}
              </span>
              <strong className="customer-pi-item-total">
                {line.totals?.totalCents == null
                  ? "Pending"
                  : usd(line.totals.totalCents)}
              </strong>
            </li>
          );
        })}
      </ul>
      <dl className="customer-pi-totals">
        <div>
          <dt>Merchandise after discount</dt>
          <dd>{usd(snapshot.totals.merchandiseCents)}</dd>
        </div>
        {snapshot.totals.discountCents > 0 && (
          <div>
            <dt>Discount included</dt>
            <dd>{usd(snapshot.totals.discountCents)}</dd>
          </div>
        )}
        {charges.map(([key, cents]) => (
          <div key={key}>
            <dt>{chargeLabels[key] ?? key}</dt>
            <dd>{usd(cents)}</dd>
          </div>
        ))}
        <div className="customer-pi-grand-total">
          <dt>Total</dt>
          <dd>{usd(snapshot.totals.totalCents)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Terms({ snapshot }: { snapshot: Snapshot }) {
  const terms = snapshot.terms;
  if (!terms) return null;
  return (
    <section className="customer-quote-section customer-pi-card">
      <h2>Commercial terms</h2>
      <dl className="customer-pi-facts">
        <div>
          <dt>Delivery terms</dt>
          <dd>
            {terms.incoterm} · {terms.namedPlace}
          </dd>
        </div>
        <div>
          <dt>Transport</dt>
          <dd>
            {terms.transportMethod} ·{" "}
            {terms.shipmentMode === "split"
              ? "Split shipment"
              : "Ship together"}
          </dd>
        </div>
        <div>
          <dt>Lead time</dt>
          <dd>{terms.leadTime || "Not specified"}</dd>
        </div>
        <div>
          <dt>Sales tax</dt>
          <dd>{terms.taxTreatment}</dd>
        </div>
      </dl>
      {terms.shipmentMode === "split" && terms.splitPlan && (
        <p className="customer-pi-muted">Split plan: {terms.splitPlan}</p>
      )}
      {snapshot.conditions && (
        <details className="customer-pi-conditions">
          <summary>Cancellation and refund conditions</summary>
          <h3>Cancellation</h3>
          <p>{snapshot.conditions.cancellation.text}</p>
          <h3>Refunds and returns</h3>
          <p>{snapshot.conditions.refund.text}</p>
        </details>
      )}
    </section>
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
    payment?: Payment | null;
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
  const canAccept =
    !!status &&
    !status.acceptance &&
    status.current &&
    !status.expired &&
    (!lifecycle || lifecycle.canAccept);
  const stateLabel =
    lifecycle?.state === "superseded"
      ? "Superseded"
      : status?.acceptance
        ? "Accepted"
        : status && !status.current
          ? "Previous PI"
          : status?.expired
            ? "Expired"
            : (lifecycle?.label ?? "Ready for acceptance");
  const stateTone =
    stateLabel === "Accepted"
      ? "delivered"
      : stateLabel === "Ready for acceptance"
        ? "ready"
        : stateLabel === "Expired" || stateLabel === "Superseded"
          ? "hold"
          : "";
  return (
    <AccountWorkspace activeView="my-quotes">
      <main className="customer-quote-detail account-detail-content customer-pi-page">
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
            <header className="customer-pi-hero">
              <div>
                <div className="customer-pi-hero-title">
                  <h2>{snapshot.documentNumber}</h2>
                  <span className={`customer-order-badge ${stateTone}`}>
                    {stateLabel}
                  </span>
                </div>
                <p>
                  Version {snapshot.documentVersion} · Quote revision{" "}
                  {snapshot.quoteRevision.number}
                  {lifecycle?.awaitingReplacement && " · Updated PI pending"}
                </p>
              </div>
              <strong className="customer-pi-total">
                {usd(snapshot.totals.totalCents)}
              </strong>
            </header>
            <div className="customer-pi-actions">
              {payment?.orderId ? (
                <Link
                  className="button button-primary"
                  to={`/account/orders/${encodeURIComponent(payment.orderId)}`}
                >
                  View confirmed order
                </Link>
              ) : (
                canAccept && (
                  <Link
                    className="button button-primary"
                    to={`${base}/pi/${encodeURIComponent(invoice.id)}/accept`}
                  >
                    Review and accept PI
                  </Link>
                )
              )}
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
              {status?.acceptance && (
                <Link
                  className="button button-secondary"
                  to={`${base}/pi/${encodeURIComponent(invoice.id)}/accept`}
                >
                  Acceptance record
                </Link>
              )}
            </div>
            <dl className="customer-pi-facts customer-pi-key-facts">
              <div>
                <dt>Issued (ET)</dt>
                <dd>{formatPiDate(snapshot.issuedAt, "customer")}</dd>
              </div>
              <div>
                <dt>Valid until (ET)</dt>
                <dd>{formatPiDate(snapshot.validUntil, "customer")}</dd>
              </div>
              {snapshot.terms && (
                <>
                  <div>
                    <dt>Delivery</dt>
                    <dd>
                      {snapshot.terms.incoterm} · {snapshot.terms.namedPlace}
                    </dd>
                  </div>
                  <div>
                    <dt>Lead time</dt>
                    <dd>{snapshot.terms.leadTime || "Not specified"}</dd>
                  </div>
                </>
              )}
            </dl>
            {payment && <PaymentProgress payment={payment} />}
            {showPaymentInstructions && (
              <section className="customer-quote-section customer-pi-card">
                <h2>Payment instructions</h2>
                {invoice.paymentInstructions ? (
                  <>
                    <p className="customer-pi-muted">
                      {invoice.paymentInstructions.channel === "paypal"
                        ? "PayPal"
                        : "Bank transfer"}{" "}
                      · Version {invoice.paymentInstructions.version}
                    </p>
                    <p className="customer-pi-instructions">
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
            <Parties snapshot={snapshot} />
            <Items snapshot={snapshot} />
            <Terms snapshot={snapshot} />
          </>
        )}
        <PiLifecycleHistory records={history} />
      </main>
    </AccountWorkspace>
  );
}
