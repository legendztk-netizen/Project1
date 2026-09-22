import { formatQuoteAmounts } from "../../quote-list/domain/quote-currency-totals";
import { Link } from "react-router";
import { useId, useRef, useState } from "react";

import {
  customerQuoteProgressStages,
  type CustomerQuoteProjection,
  type CustomerQuoteProgressCode,
} from "../domain/quote-request";
import {
  customerQuoteDateTime,
  quoteImportHandling,
  quotePurchasingAs,
} from "./customer-quote-presentation";
import { CustomerQuoteRequestPreview } from "./customer-quote-product-preview";

export function CustomerQuoteList({
  quoteRequests,
}: {
  quoteRequests: CustomerQuoteProjection[];
}) {
  const [selected, setSelected] = useState<CustomerQuoteProgressCode | "all">(
    "all",
  );
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = [
    { code: "all" as const, label: "All Quotes" },
    ...customerQuoteProgressStages.filter(
      (stage) =>
        !["PAYMENT_PENDING", "PAYMENT_CONFIRMED", "ORDER_CREATED"].includes(
          stage.code,
        ) || quoteRequests.some((quote) => quote.progress.code === stage.code),
    ),
  ];
  const visibleQuotes =
    selected === "all"
      ? quoteRequests
      : quoteRequests.filter((quote) => quote.progress.code === selected);
  return (
    <section className="account-record-detail customer-quotes-detail">
      <span className="eyebrow">Requests and quotes</span>
      <h1>My Quotes</h1>
      <p className="account-detail-intro">
        Track submitted requests here. A formal quoted price and PI will appear
        only after our team prepares them.
      </p>
      <div
        className="customer-quote-tabs"
        role="tablist"
        aria-label="Quote status"
      >
        {tabs.map((tab, index) => {
          const count =
            tab.code === "all"
              ? quoteRequests.length
              : quoteRequests.filter(
                  (quote) => quote.progress.code === tab.code,
                ).length;
          return (
            <button
              key={tab.code}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              id={`${id}-${tab.code}`}
              type="button"
              role="tab"
              aria-selected={selected === tab.code}
              aria-controls={`${id}-panel`}
              tabIndex={selected === tab.code ? 0 : -1}
              onClick={() => setSelected(tab.code)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + tabs.length) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                setSelected(tabs[next].code);
                buttons.current[next]?.focus();
              }}
            >
              <span className="customer-quote-tab-label" data-label={tab.label}>
                <span>{tab.label}</span>
              </span>
              <span className="customer-quote-tab-count">{count}</span>
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${selected}`}
        tabIndex={0}
      >
        {visibleQuotes.length === 0 ? (
          <div className="account-inline-empty">
            <p>
              {quoteRequests.length === 0
                ? "No submitted quote requests yet."
                : "No quotes in this status."}
            </p>
            {quoteRequests.length === 0 ? (
              <Link className="button button-secondary" to="/">
                Browse products
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="customer-quote-list">
            {visibleQuotes.map((quoteRequest) => (
              <article key={quoteRequest.id}>
                <div className="customer-quote-list-heading">
                  <div>
                    <span>{quoteRequest.progress.label}</span>
                    <h2>{quoteRequest.referenceNumber}</h2>
                  </div>
                  <CustomerQuoteRequestPreview
                    lines={quoteRequest.snapshot.lines}
                  />
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
                    <dt>
                      {quoteRequest.currentPi
                        ? quoteRequest.progress.code ===
                          "PI_REPLACEMENT_REQUIRED"
                          ? "Previous PI total"
                          : quoteRequest.progress.code === "PI_EXPIRED"
                            ? "Expired PI total"
                            : "PI total"
                        : "Submitted merchandise reference"}
                    </dt>
                    <dd>
                      {quoteRequest.currentPi ? (
                        <>
                          <strong className="customer-quote-pi-total">
                            {quoteRequest.currentPi.currency === "USD" &&
                            typeof quoteRequest.currentPi.totalCents ===
                              "number" &&
                            Number.isSafeInteger(
                              quoteRequest.currentPi.totalCents,
                            ) &&
                            quoteRequest.currentPi.totalCents >= 0
                              ? `USD ${(quoteRequest.currentPi.totalCents / 100).toFixed(2)}`
                              : "Not available"}
                          </strong>
                          <span className="customer-quote-submitted-reference">
                            Submitted merchandise reference:{" "}
                            {formatQuoteAmounts(quoteRequest.snapshot.amounts)}
                          </span>
                        </>
                      ) : (
                        formatQuoteAmounts(quoteRequest.snapshot.amounts)
                      )}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
