import { formatQuoteAmounts } from "../../quote-list/domain/quote-currency-totals";
import { CustomerQuoteOffer } from "../../quote-review/ui/customer-quote-offer";
import { QuoteRevisionChanges } from "../../quote-review/ui/quote-revision-changes";
import { ArrowLeft } from "lucide-react";
import { Link, data, redirect } from "react-router";

import type { Route } from "./+types/customer-quote-detail";
import { AccountWorkspace } from "../ui/account-workspace";
import { CustomerQuoteNavigation } from "../ui/customer-quote-navigation";
import { createQuoteRequestService } from "../../quote-request/application/quote-request-service";
import type { AnonymousQuoteLine } from "../../quote-list/domain/anonymous-quote-list";
import {
  customerQuoteDateTime,
  quoteImportHandling,
  quotePurchasingAs,
} from "../../quote-request/ui/customer-quote-presentation";
import { CustomerQuoteProductPreview } from "../../quote-request/ui/customer-quote-product-preview";
import {
  customerQuoteNextStep,
  customerQuoteStep,
  customerQuoteStepLabels,
} from "../../quote-request/ui/customer-quote-next-step";
import { ShipmentStepper } from "../../shipment/ui/shipment-stepper";
import { cloudflareContext } from "#workers/context";
import { customerPaymentProgress } from "../../proforma-invoice/application/customer-payment-progress";

export function meta() {
  return [{ title: "Quote Request | Account & Lists" }];
}
export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const result = await createQuoteRequestService(env).readOwned(
    request,
    params.requestId,
  );
  if (!result.authenticated) {
    const returnTo = new URL(request.url).pathname;
    return redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!result.record) throw new Response("Not found", { status: 404 });
  const [quoteRequest] = await customerPaymentProgress(
    env.DB,
    result.profileId,
    [result.record],
  );
  return data({ quoteRequest }, { headers: headers() });
}

function lineDetails(line: AnonymousQuoteLine) {
  if (line.lineKind === "length_based_hose") {
    return `${line.lengthOrder.originalLengthValue} ft per piece`;
  }
  if (line.lineKind === "configured_assembly") {
    const configuration = line.configuredAssembly.snapshot.configuration;
    const length = configuration.finishedLength;
    return [
      configuration.endA?.hoseEnd.displayName,
      configuration.endB?.hoseEnd.displayName,
      length
        ? `${length.originalValue} ${length.originalUnit} finished length`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return line.salesUnit;
}

function configuredAssemblyDetails(line: AnonymousQuoteLine) {
  if (line.lineKind !== "configured_assembly") return null;
  const configuration = line.configuredAssembly.snapshot.configuration;
  const measurement = configuration.measurementSelection;
  const clocking = configuration.clocking;
  const application = configuration.applicationRequirements;
  return (
    <dl className="customer-configured-assembly-details">
      <div>
        <dt>Hose</dt>
        <dd>
          {configuration.hose.familyName}
          {configuration.hose.nominalIdIn
            ? ` · ${configuration.hose.nominalIdIn} in hose ID`
            : ""}
          {configuration.hose.dash ? ` (${configuration.hose.dash})` : ""}
        </dd>
      </div>
      <div>
        <dt>End A</dt>
        <dd>{configuration.endA?.hoseEnd.displayName ?? "Not selected"}</dd>
      </div>
      <div>
        <dt>End B</dt>
        <dd>{configuration.endB?.hoseEnd.displayName ?? "Not selected"}</dd>
      </div>
      <div>
        <dt>Finished length</dt>
        <dd>
          {configuration.finishedLength
            ? `${configuration.finishedLength.originalValue} ${configuration.finishedLength.originalUnit}`
            : "Not selected"}
        </dd>
      </div>
      <div>
        <dt>Measurement</dt>
        <dd>
          {measurement?.state === "selected"
            ? `${measurement.method.code} · ${measurement.method.displayName}`
            : "Not sure · Technical review required"}
        </dd>
      </div>
      <div>
        <dt>Clocking</dt>
        <dd>
          {clocking?.status === "specified"
            ? `${clocking.targetDisplay}° clockwise`
            : clocking?.status === "not_sure"
              ? "Not sure · Technical review required"
              : "Not applicable"}
        </dd>
      </div>
      <div>
        <dt>Installed protection</dt>
        <dd>
          {configuration.installedProtection?.publicName ?? "Not selected"}
        </dd>
      </div>
      <div>
        <dt>Application details</dt>
        <dd>
          {application
            ? `${application.fluidMedium.replaceAll("_", " ")} · ${application.maximumWorkingPressure.originalValue} ${application.maximumWorkingPressure.originalUnit} · ${application.minimumOperatingTemperature.originalValue}–${application.maximumOperatingTemperature.originalValue} °${application.minimumOperatingTemperature.originalUnit}`
            : "Not provided (Optional)"}
        </dd>
      </div>
    </dl>
  );
}

function quoteAmount(
  quoteRequest: Route.ComponentProps["loaderData"]["quoteRequest"],
) {
  const pi = quoteRequest.currentPi;
  if (!pi)
    return {
      label: "Submitted merchandise reference",
      value: formatQuoteAmounts(quoteRequest.snapshot.amounts),
    };
  return {
    label:
      quoteRequest.progress.code === "PI_REPLACEMENT_REQUIRED"
        ? "Previous PI total"
        : quoteRequest.progress.code === "PI_EXPIRED"
          ? "Expired PI total"
          : "PI total",
    value:
      pi.currency === "USD" &&
      typeof pi.totalCents === "number" &&
      Number.isSafeInteger(pi.totalCents) &&
      pi.totalCents >= 0
        ? `USD ${(pi.totalCents / 100).toFixed(2)}`
        : "Not available",
  };
}

export default function CustomerQuoteDetail({
  loaderData,
}: Route.ComponentProps) {
  const quoteRequest = loaderData.quoteRequest;
  const snapshot = quoteRequest.snapshot;
  const next = customerQuoteNextStep(quoteRequest);
  const amount = quoteAmount(quoteRequest);
  const lineCount = snapshot.lines.length;

  return (
    <AccountWorkspace activeView="my-quotes">
      <main className="customer-quote-detail account-detail-content">
        <Link className="customer-quote-back-link" to="/account?view=my-quotes">
          <ArrowLeft aria-hidden="true" size={17} /> Back to My Quotes
        </Link>

        <header className="customer-pi-hero customer-quote-hero">
          <div>
            <span className="eyebrow">Quote request</span>
            <div className="customer-pi-hero-title">
              <h1>{quoteRequest.referenceNumber}</h1>
              <span className="customer-order-badge">
                {quoteRequest.progress.label}
              </span>
            </div>
            <p>
              Submitted{" "}
              {customerQuoteDateTime.format(new Date(quoteRequest.submittedAt))}{" "}
              · {lineCount} item{lineCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="customer-quote-hero-amount">
            <span>{amount.label}</span>
            <strong className="customer-pi-total">{amount.value}</strong>
          </div>
        </header>
        <CustomerQuoteNavigation requestId={quoteRequest.id} />

        <section
          className="customer-quote-section customer-quote-next"
          aria-label="Quote progress"
        >
          <ShipmentStepper
            labels={customerQuoteStepLabels}
            completed={customerQuoteStep(quoteRequest)}
          />
          <div className="customer-quote-next-row">
            <div>
              <strong>What happens next</strong>
              <p>{next.summary}</p>
            </div>
            {next.action && (
              <Link
                className={`button ${next.action.primary ? "button-primary" : "button-secondary"}`}
                to={next.action.to}
              >
                {next.action.label}
              </Link>
            )}
          </div>
        </section>

        {quoteRequest.currentOffer ? (
          <CustomerQuoteOffer offer={quoteRequest.currentOffer} />
        ) : null}
        {quoteRequest.proposedChanges?.length ? (
          <section className="customer-quote-section">
            <h2>Proposed revision · Not yet issued</h2>
            <QuoteRevisionChanges changes={quoteRequest.proposedChanges} />
          </section>
        ) : null}
        {(quoteRequest.offerHistory?.length ?? 0) > 1 ? (
          <section className="customer-quote-section">
            <h2>Previous quote versions</h2>
            {quoteRequest.offerHistory!.slice(1).map((offer) => (
              <details key={offer.id} className="customer-quote-history">
                <summary>
                  Revision {offer.revisionNumber} ·{" "}
                  {customerQuoteDateTime.format(new Date(offer.issuedAt))}
                </summary>
                <CustomerQuoteOffer offer={offer} />
              </details>
            ))}
          </section>
        ) : null}

        <section className="customer-quote-section">
          <h2>Submitted products</h2>
          <div className="customer-quote-lines">
            {snapshot.lines.map((line) => {
              const assembly = configuredAssemblyDetails(line);
              return (
                <article key={line.id}>
                  <div className="customer-quote-line-copy">
                    <h3>{line.displayName}</h3>
                    <p>SKU {line.sku}</p>
                    <p>{lineDetails(line)}</p>
                  </div>
                  <CustomerQuoteProductPreview line={line} />
                  <strong className="customer-quote-line-quantity">
                    Qty {line.quantity}
                  </strong>
                  {assembly && (
                    <details className="customer-quote-line-spec">
                      <summary>Assembly specification</summary>
                      {assembly}
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="customer-quote-section">
          <h2>Request details</h2>
          <dl className="customer-pi-facts">
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
              <dd>{formatQuoteAmounts(snapshot.amounts)}</dd>
            </div>
            <div>
              <dt>Delivery destination</dt>
              <dd>
                <address className="customer-quote-address">
                  {snapshot.destination.recipientName}
                  <br />
                  {snapshot.destination.addressLine1}
                  {snapshot.destination.addressLine2 ? (
                    <>
                      <br />
                      {snapshot.destination.addressLine2}
                    </>
                  ) : null}
                  <br />
                  {snapshot.destination.city},{" "}
                  {snapshot.destination.stateProvince}{" "}
                  {snapshot.destination.postalCode}
                  <br />
                  {snapshot.destination.countryCode}
                </address>
              </dd>
            </div>
          </dl>
          <p className="customer-quote-commercial-note">
            This is the submitted request snapshot, not a formal quoted price,
            PI, payment request or order.
          </p>
        </section>
      </main>
    </AccountWorkspace>
  );
}
