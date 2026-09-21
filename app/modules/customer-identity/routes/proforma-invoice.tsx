import { Link, data, type LoaderFunctionArgs } from "react-router";
import { ArrowLeft, Download, Eye } from "lucide-react";
import { cloudflareContext } from "#workers/context";
import {
  proformaInvoices,
  piCustomerProfile,
  piPrivateHeaders,
  piRouteId,
  type PiRecord,
} from "#workers/proforma-invoice";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import { AccountWorkspace } from "../ui/account-workspace";

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
  return data({ requestId, invoice }, { headers: headers() });
}

export default function ProformaInvoice({
  loaderData,
}: {
  loaderData: { requestId: string; invoice: PiRecord | null };
}) {
  const { requestId, invoice } = loaderData;
  const base = `/account/quotes/${encodeURIComponent(requestId)}`;
  const snapshot = invoice?.snapshot;
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <a
                className="button button-secondary"
                href={`${base}/pi/${encodeURIComponent(invoice.id)}/pdf?disposition=inline`}
                target="_blank"
                rel="noreferrer"
              >
                <Eye size={18} />
                View PI
              </a>
              <a
                className="button button-secondary"
                href={`${base}/pi/${encodeURIComponent(invoice.id)}/pdf`}
              >
                <Download size={18} />
                Download PI
              </a>
            </div>
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
                  Current payment instructions are unavailable. Contact Support
                  before sending payment.
                </p>
              )}
            </section>
            <section className="customer-quote-section">
              <h2>Seller</h2>
              <p>{snapshot.seller.legalName}</p>
              <address style={{ whiteSpace: "pre-wrap" }}>
                {snapshot.seller.registeredAddressEn}
              </address>
            </section>
          </>
        )}
      </main>
    </AccountWorkspace>
  );
}
