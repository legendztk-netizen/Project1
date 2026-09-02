import { Link } from "react-router";

import type { CustomerQuoteProjection } from "../domain/quote-request";
import {
  customerQuoteDateTime,
  quoteImportHandling,
  quotePurchasingAs,
} from "./customer-quote-presentation";

export function CustomerQuoteList({
  quoteRequests,
}: {
  quoteRequests: CustomerQuoteProjection[];
}) {
  return (
    <section className="account-record-detail customer-quotes-detail">
      <span className="eyebrow">Requests and quotes</span>
      <h1>My Quotes</h1>
      <p className="account-detail-intro">
        Track submitted requests here. A formal quoted price and PI will appear
        only after our team prepares them.
      </p>
      {quoteRequests.length === 0 ? (
        <div className="account-inline-empty">
          <p>No submitted quote requests yet.</p>
          <Link className="button button-secondary" to="/">
            Browse products
          </Link>
        </div>
      ) : (
        <div className="customer-quote-list">
          {quoteRequests.map((quoteRequest) => (
            <article key={quoteRequest.id}>
              <div className="customer-quote-list-heading">
                <div>
                  <span>{quoteRequest.progress.label}</span>
                  <h2>{quoteRequest.referenceNumber}</h2>
                </div>
                <Link
                  className="button button-secondary"
                  to={`/account/quotes/${encodeURIComponent(quoteRequest.id)}`}
                >
                  View details
                </Link>
              </div>
              <dl>
                <div>
                  <dt>Submitted</dt>
                  <dd>
                    {customerQuoteDateTime.format(
                      new Date(quoteRequest.submittedAt),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Purchasing as</dt>
                  <dd>{quotePurchasingAs(quoteRequest)}</dd>
                </div>
                <div>
                  <dt>Import handling</dt>
                  <dd>{quoteImportHandling(quoteRequest)}</dd>
                </div>
                <div>
                  <dt>Merchandise reference</dt>
                  <dd>
                    USD{" "}
                    {quoteRequest.snapshot.amounts.merchandiseSubtotal.toFixed(
                      2,
                    )}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
