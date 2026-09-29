import { useEffect, useState } from "react";
import "../ui/pi-acceptance-form.css";
import {
  Form,
  Link,
  data,
  redirect,
  useNavigation,
  useRevalidator,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { ArrowLeft, Check, Download, Eye, RefreshCw } from "lucide-react";
import { cloudflareContext } from "#workers/context";
import {
  piAcceptance,
  piAcceptanceRequestEvidence,
  type PiAcceptanceStatus,
} from "#workers/pi-acceptance";
import {
  piCustomerProfile,
  piPrivateHeaders,
  piRouteId,
  proformaInvoices,
  type PiRecord,
} from "#workers/proforma-invoice";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import { AccountWorkspace } from "../ui/account-workspace";
import { readyScheduleText } from "../../shipment/domain/ready-schedule";

export const headers = piPrivateHeaders;
export function meta() {
  return [{ title: "Accept Proforma Invoice | My Quotes" }];
}

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareContext);
  const profileId = await piCustomerProfile(env, request);
  const requestId = piRouteId(params.requestId);
  const piId = piRouteId(params.piId);
  const invoice = await proformaInvoices(env).customerRead(
    profileId,
    requestId,
    piId,
  );
  const status = await piAcceptance(env).customerStatus(
    profileId,
    requestId,
    piId,
  );
  if (
    invoice.id !== status.piId ||
    invoice.snapshot.documentVersion !== status.documentVersion ||
    invoice.snapshotHash !== status.snapshotHash
  )
    throw new Response("PI changed; reload before accepting", {
      status: 409,
      headers: headers(),
    });
  return data(
    { requestId, invoice, status, commandId: crypto.randomUUID() },
    { headers: headers() },
  );
}

interface LinePolicy {
  lineId: string;
  version: string;
  cancellationVersion: string;
}
function linePolicies(value: string): LinePolicy[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Response("Invalid line acknowledgements", { status: 400 });
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 500 ||
    parsed.some(
      (item) =>
        !item ||
        typeof item.lineId !== "string" ||
        typeof item.version !== "string" ||
        typeof item.cancellationVersion !== "string",
    )
  )
    throw new Response("Invalid line acknowledgements", { status: 400 });
  return parsed;
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { env } = context.get(cloudflareContext);
  const profileId = await piCustomerProfile(env, request);
  requireReviewMutation(request);
  const requestId = piRouteId(params.requestId);
  const piId = piRouteId(params.piId);
  const form = await readPrivateReviewForm(request);
  const field = (key: string) =>
    typeof form.get(key) === "string" ? String(form.get(key)) : "";
  try {
    if (field("intent") !== "accept" || field("piId") !== piId)
      throw new Response("Invalid acceptance target", { status: 400 });
    if (!field("legalName").trim())
      throw new Response("Enter your legal name", { status: 400 });
    if (!field("viewId"))
      throw new Response("Successfully view or download this exact PI first", {
        status: 400,
      });
    const policies = linePolicies(field("linePolicies"));
    if (
      field("generalConfirmed") !== "on" ||
      policies.some(
        (_, index) =>
          field(`specifications-${index}`) !== "on" ||
          field(`cancellation-${index}`) !== "on",
      )
    )
      throw new Response(
        "Confirm the general terms and each made-to-order specification and cancellation acknowledgement",
        { status: 400 },
      );
    await piAcceptance(env).accept(
      profileId,
      request,
      {
        requestId,
        piId,
        documentVersion: Number(field("documentVersion")),
        snapshotHash: field("snapshotHash"),
        commandId: field("commandId"),
        viewId: field("viewId"),
        legalName: field("legalName"),
        acknowledgements: {
          general: {
            version: field("generalVersion"),
            confirmed: field("generalConfirmed") === "on",
          },
          madeToOrder: policies.map((policy, index) => ({
            lineIds: [policy.lineId],
            version: policy.version,
            cancellationVersion: policy.cancellationVersion,
            specificationsConfirmed: field(`specifications-${index}`) === "on",
            cancellationConfirmed: field(`cancellation-${index}`) === "on",
          })),
        },
      },
      piAcceptanceRequestEvidence(request),
    );
  } catch (error) {
    if (!(error instanceof Response) || ![400, 409].includes(error.status))
      throw error;
    return data(
      {
        error:
          error.status === 409
            ? "This PI or its acceptance state changed. Refresh the status before continuing."
            : await error.text(),
      },
      { status: error.status, headers: headers() },
    );
  }
  return redirect(
    `/account/quotes/${encodeURIComponent(requestId)}/pi/${encodeURIComponent(piId)}/accept`,
    { headers: headers() },
  );
}

export interface AcceptancePageData {
  requestId: string;
  invoice: PiRecord;
  status: PiAcceptanceStatus;
  commandId: string;
}

function AcceptanceForm({
  invoice,
  status,
  commandId,
}: Omit<AcceptancePageData, "requestId">) {
  const [legalName, setLegalName] = useState("");
  const [general, setGeneral] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const pending = useNavigation().state !== "idle";
  const conditions = invoice.snapshot.conditions;
  const policies = conditions.madeToOrderAcknowledgements;
  const complete =
    legalName.trim() &&
    general &&
    policies.every(
      (_, index) =>
        checked[`specifications-${index}`] && checked[`cancellation-${index}`],
    );
  return (
    <Form method="post" className="commercial-settings-form pi-acceptance-form">
      <input type="hidden" name="intent" value="accept" />
      <input type="hidden" name="piId" value={status.piId} />
      <input
        type="hidden"
        name="documentVersion"
        value={status.documentVersion}
      />
      <input type="hidden" name="snapshotHash" value={status.snapshotHash} />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="viewId" value={status.viewId ?? ""} />
      <input
        type="hidden"
        name="generalVersion"
        value={conditions.generalAcknowledgement.version}
      />
      <input
        type="hidden"
        name="linePolicies"
        value={JSON.stringify(
          policies.map((policy) => ({
            lineId: policy.lineId,
            version: policy.version,
            cancellationVersion: conditions.cancellation.version,
          })),
        )}
      />
      <label>
        Legal name
        <input
          name="legalName"
          autoComplete="name"
          required
          maxLength={300}
          value={legalName}
          onChange={(event) => setLegalName(event.target.value)}
        />
      </label>
      {(invoice.snapshot.terms?.shipmentGroups?.some(
        (group) => group.readySchedule,
      ) ||
        invoice.snapshot.terms?.readySchedule) && (
        <section className="customer-quote-section">
          <h2>Agreed ready-to-ship schedule</h2>
          {invoice.snapshot.terms?.shipmentGroups?.length ? (
            invoice.snapshot.terms.shipmentGroups.map((group) =>
              group.readySchedule ? (
                <p key={group.id}>
                  {group.label}: {readyScheduleText(group.readySchedule)}
                </p>
              ) : null,
            )
          ) : invoice.snapshot.terms?.readySchedule ? (
            <p>{readyScheduleText(invoice.snapshot.terms.readySchedule)}</p>
          ) : null}
          <p>
            Transit time starts after dispatch and is separate from this
            preparation schedule.
          </p>
        </section>
      )}
      <label className="quote-confirmation">
        <input
          type="checkbox"
          name="generalConfirmed"
          required
          checked={general}
          onChange={(event) => setGeneral(event.target.checked)}
        />
        <span>
          <strong>PI terms confirmation</strong>
          {conditions.generalAcknowledgement.text}
        </span>
      </label>
      {policies.map((policy, index) => {
        const line = invoice.snapshot.lines.find(
          (item) => item.id === policy.lineId,
        );
        return (
          <section className="customer-quote-section" key={policy.lineId}>
            <h2>{line?.displayName ?? policy.lineId}</h2>
            <p>
              SKU {line?.sku} · Quantity {line?.quantity} {line?.salesUnit}
            </p>
            <label className="quote-confirmation">
              <input
                name={`specifications-${index}`}
                type="checkbox"
                required
                checked={!!checked[`specifications-${index}`]}
                onChange={(event) =>
                  setChecked((previous) => ({
                    ...previous,
                    [`specifications-${index}`]: event.target.checked,
                  }))
                }
              />
              <span>
                <strong>Specifications confirmation</strong>
                {policy.text}
              </span>
            </label>
            <label className="quote-confirmation">
              <input
                name={`cancellation-${index}`}
                type="checkbox"
                required
                checked={!!checked[`cancellation-${index}`]}
                onChange={(event) =>
                  setChecked((previous) => ({
                    ...previous,
                    [`cancellation-${index}`]: event.target.checked,
                  }))
                }
              />
              <span>
                <strong>Cancellation acknowledgement</strong>I acknowledge the
                cancellation conditions for this line:{" "}
                {conditions.cancellation.text}
              </span>
            </label>
          </section>
        );
      })}
      <section className="customer-quote-section">
        <h2>Cancellation conditions</h2>
        <p>{conditions.cancellation.text}</p>
        <h2>Refund conditions</h2>
        <p>{conditions.refund.text}</p>
      </section>
      <button
        className="button button-primary"
        disabled={pending || !status.canAccept || !status.viewId || !complete}
      >
        <Check size={18} />
        {pending ? "Accepting PI" : "Accept this PI"}
      </button>
    </Form>
  );
}

export default function ProformaInvoiceAccept({
  loaderData,
  actionData,
}: {
  loaderData: AcceptancePageData;
  actionData?: { error: string };
}) {
  const { requestId, invoice, status } = loaderData;
  const revalidator = useRevalidator();
  useEffect(() => {
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        revalidator.state === "idle"
      )
        void revalidator.revalidate();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [revalidator]);
  const base = `/account/quotes/${encodeURIComponent(requestId)}/pi/${encodeURIComponent(invoice.id)}`;
  const target = new URLSearchParams(
    status.current && !status.expired
      ? {
          documentVersion: String(status.documentVersion),
          snapshotHash: status.snapshotHash,
        }
      : {},
  );
  const accepted = status.acceptance;
  return (
    <AccountWorkspace activeView="my-quotes">
      <main
        className="customer-quote-detail account-detail-content"
        style={{ minWidth: 0, overflowWrap: "anywhere" }}
      >
        <Link to={base}>
          <ArrowLeft size={17} />
          Back to PI
        </Link>
        <h1>{accepted ? "PI Accepted" : "Accept proforma invoice"}</h1>
        <h2>
          {invoice.snapshot.documentNumber} · Version {status.documentVersion}
        </h2>
        <p>
          Valid until (ET):{" "}
          {formatPiDate(invoice.snapshot.validUntil, "customer")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <a
            className="button button-secondary"
            href={`${base}/pdf?${target}&disposition=inline`}
            target="_blank"
            rel="noreferrer"
          >
            <Eye size={18} />
            View PI
          </a>
          <a
            className="button button-secondary"
            href={`${base}/pdf?${target}`}
            target="_blank"
            rel="noreferrer"
          >
            <Download size={18} />
            Download PI
          </a>
          <button
            type="button"
            className="button button-secondary"
            disabled={revalidator.state !== "idle"}
            onClick={() => void revalidator.revalidate()}
          >
            <RefreshCw size={18} />
            Refresh status
          </button>
        </div>
        {actionData?.error && <p role="alert">{actionData.error}</p>}
        {accepted ? (
          <section className="customer-quote-section">
            <h2>Acceptance record</h2>
            <dl className="customer-quote-summary">
              <div>
                <dt>Legal name</dt>
                <dd>{accepted.legalName}</dd>
              </div>
              <div>
                <dt>Accepted (ET)</dt>
                <dd>{formatPiDate(accepted.acceptedAt, "customer")}</dd>
              </div>
              <div>
                <dt>PI version</dt>
                <dd>{accepted.documentVersion}</dd>
              </div>
              <div>
                <dt>Snapshot hash</dt>
                <dd>{accepted.snapshotHash}</dd>
              </div>
              <div>
                <dt>Acceptance ID</dt>
                <dd>{accepted.id}</dd>
              </div>
            </dl>
            <p>{accepted.acknowledgements.general.text}</p>
            {accepted.acknowledgements.madeToOrder.map((ack) => (
              <p key={ack.lineId}>
                Line {ack.lineId} · {ack.text} · Cancellation version{" "}
                {ack.cancellationVersion}
              </p>
            ))}
            <p>
              PI acceptance does not confirm payment, create an order, or
              release production.
            </p>
          </section>
        ) : !status.current || status.expired ? (
          <p role="alert">
            {status.expired
              ? "This PI has expired and cannot be accepted."
              : "This PI is no longer current and cannot be accepted."}
          </p>
        ) : (
          <>
            {!status.viewId && (
              <p role="status">
                Successfully view or download this exact PI before accepting it.
              </p>
            )}
            <AcceptanceForm
              key={`${status.piId}:${status.documentVersion}:${status.snapshotHash}`}
              {...loaderData}
            />
          </>
        )}
      </main>
    </AccountWorkspace>
  );
}
