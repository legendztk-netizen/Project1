import { ArrowLeft, FileText } from "lucide-react";
import { Link, redirect } from "react-router";

import type { Route } from "./+types/customer-quote-detail";
import { AccountWorkspace } from "../ui/account-workspace";
import { createQuoteRequestService } from "../../quote-request/application/quote-request-service";
import type { AnonymousQuoteLine } from "../../quote-list/domain/anonymous-quote-list";
import {
  customerQuoteDateTime,
  quoteImportHandling,
  quotePurchasingAs,
} from "../../quote-request/ui/customer-quote-presentation";
import { cloudflareContext } from "#workers/context";

export function meta() {
  return [{ title: "Quote Request | Account & Lists" }];
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
  return { quoteRequest: result.record };
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

export default function CustomerQuoteDetail({
  loaderData,
}: Route.ComponentProps) {
  const quoteRequest = loaderData.quoteRequest;
  const snapshot = quoteRequest.snapshot;

  return (
    <AccountWorkspace activeView="my-quotes">
      <main className="customer-quote-detail account-detail-content">
        <Link className="customer-quote-back-link" to="/account?view=my-quotes">
          <ArrowLeft aria-hidden="true" size={17} /> Back to My Quotes
        </Link>

        <header className="customer-quote-detail-header">
          <div>
            <span className="eyebrow">Quote request</span>
            <h1>{quoteRequest.referenceNumber}</h1>
            <p>
              Submitted{" "}
              {customerQuoteDateTime.format(new Date(quoteRequest.submittedAt))}
            </p>
          </div>
          <span className="customer-quote-status">
            {quoteRequest.progress.label}
          </span>
        </header>

        <section
          className="customer-quote-progress"
          aria-label="Quote progress"
        >
          <FileText aria-hidden="true" size={22} />
          <div>
            <strong>{quoteRequest.progress.label}</strong>
            <p>We received your request and will prepare the formal quote.</p>
          </div>
        </section>

        <section className="customer-quote-section">
          <h2>Submitted products</h2>
          <div className="customer-quote-lines">
            {snapshot.lines.map((line) => (
              <article key={line.id}>
                <div>
                  <h3>{line.displayName}</h3>
                  <p>SKU {line.sku}</p>
                  <p>{lineDetails(line)}</p>
                </div>
                <strong>Qty {line.quantity}</strong>
                {configuredAssemblyDetails(line)}
              </article>
            ))}
          </div>
        </section>

        <div className="customer-quote-detail-grid">
          <section className="customer-quote-section">
            <h2>Delivery destination</h2>
            <address>
              <strong>{snapshot.destination.recipientName}</strong>
              <span>{snapshot.destination.addressLine1}</span>
              {snapshot.destination.addressLine2 ? (
                <span>{snapshot.destination.addressLine2}</span>
              ) : null}
              <span>
                {snapshot.destination.city},{" "}
                {snapshot.destination.stateProvince}{" "}
                {snapshot.destination.postalCode}
              </span>
              <span>{snapshot.destination.countryCode}</span>
            </address>
          </section>

          <section className="customer-quote-section">
            <h2>Request summary</h2>
            <dl className="customer-quote-summary">
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
                <dd>USD {snapshot.amounts.merchandiseSubtotal.toFixed(2)}</dd>
              </div>
            </dl>
            <p className="customer-quote-commercial-note">
              This is the submitted request snapshot, not a formal quoted price,
              PI, payment request or order.
            </p>
          </section>
        </div>
      </main>
    </AccountWorkspace>
  );
}
