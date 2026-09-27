import { Link } from "react-router";
import { MessagesSquare, Paperclip } from "lucide-react";

import type { CaseReason, CustomerCases } from "../application/case-service";
import type { ReturnAuthorizationView } from "../application/return-authorization-service";
import type { ReceiptView } from "../application/return-inspection-service";
import { usd } from "../domain/refund-calculation";
import { etDisplayDate } from "../domain/return-policy";
import { customerCaseReasonLabel } from "./customer-cases";
import {
  CustomerRefundResponse,
  RefundBreakdown,
  refundStatusLabel,
} from "./refund-breakdown";
import { CustomerReturnAuthorizations } from "./return-authorizations";
import "./after-sales.css";

type CaseItem = CustomerCases["cases"][number];

function etDateTime(value: string) {
  return `${new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  })} ET`;
}

/** One-line answer to "what happens next?" for a customer's Case. */
export function customerCaseNextStep(
  item: Pick<CaseItem, "status">,
  ras: Pick<
    ReturnAuthorizationView,
    "id" | "expired" | "arrivalDeadlineDateEt"
  >[],
  receipts: Array<
    Pick<
      ReceiptView,
      | "raId"
      | "decision"
      | "timeliness"
      | "lateReviewed"
      | "inspectionDeadlineDateEt"
    >
  >,
) {
  const refunds = receipts.flatMap((receipt) =>
    (receipt.decision?.refunds ?? []).filter(
      (refund) => refund.status !== "superseded",
    ),
  );
  if (
    refunds.some((refund) => refund.status === "awaiting_customer_confirmation")
  )
    return "Please confirm or dispute the refund amount below.";
  const pending = receipts.find((receipt) => !receipt.decision);
  if (pending)
    return pending.timeliness === "late" && !pending.lateReviewed
      ? "Your return arrived after the authorization expired and is under review."
      : `We received your return and are inspecting it. We aim to decide by ${etDisplayDate(pending.inspectionDeadlineDateEt)}.`;
  const unsent = refunds.find(
    (refund) => refund.initiatedCents < refund.refundCents,
  );
  if (unsent)
    return unsent.status === "disputed" || unsent.initiatedCents > 0
      ? refundStatusLabel(unsent, "en")
      : `Your refund of ${usd(unsent.refundCents)} is approved.${
          unsent.deadlineDateEt
            ? ` We'll initiate it by ${etDisplayDate(unsent.deadlineDateEt)}; your bank or PayPal may take longer to post it.`
            : ""
        }`;
  const awaitingReturn = ras.find(
    (ra) => !ra.expired && !receipts.some((receipt) => receipt.raId === ra.id),
  );
  if (awaitingReturn && item.status === "open")
    return `Please send the items back so they arrive by 11:59 PM ET on ${etDisplayDate(awaitingReturn.arrivalDeadlineDateEt)}. See the return instructions below.`;
  if (item.status === "closed") return "This case is closed.";
  if (refunds.length) return "Your refund has been initiated.";
  return "We're reviewing your report and will reply in Messages with next steps.";
}

export function CustomerReturnsTab({
  cases,
  ras,
  receipts,
  orderId,
  requestId,
  commandId,
  busy,
}: {
  cases: CustomerCases;
  ras: ReturnAuthorizationView[];
  receipts: ReceiptView[];
  orderId: string;
  requestId: string;
  commandId: string;
  busy: boolean;
}) {
  const fileHref = (fileId: string) =>
    `/account/orders/${encodeURIComponent(orderId)}/after-sales/files/${encodeURIComponent(fileId)}`;
  const messageHref = (caseId: string) =>
    `/account/messages/${encodeURIComponent(requestId)}?case=${encodeURIComponent(caseId)}#latest`;
  return (
    <div className="after-sales-customer-cases">
      {cases.undeliveredShipments.length > 0 && (
        <p>
          {cases.undeliveredShipments.join(", ")} shipped but delivery
          isn&apos;t recorded yet. For a problem with those items,{" "}
          <Link to={`/account/messages/${encodeURIComponent(requestId)}`}>
            message us
          </Link>
          .
        </p>
      )}
      {cases.cases.map((item) => {
        const caseRas = ras.filter((ra) => ra.caseId === item.id);
        const caseReceipts = receipts.filter(
          (receipt) => receipt.caseId === item.id,
        );
        const refunds = caseReceipts.flatMap((receipt) =>
          (receipt.decision?.refunds ?? []).filter(
            (refund) => refund.status !== "superseded",
          ),
        );
        const openRas = caseRas.filter(
          (ra) =>
            !ra.expired &&
            !caseReceipts.some((receipt) => receipt.raId === ra.id),
        );
        const reportedFiles = item.files.filter(
          (file) => file.uploaderRole === "customer",
        );
        const fileName = (id: string) =>
          item.files.find((file) => file.id === id)?.filename ?? "Attachment";
        const lineName = (lineId: string) =>
          item.lines.find((line) => line.lineId === lineId)?.displayName ??
          lineId;
        return (
          <article key={item.id} className="after-sales-case-card">
            <header className="after-sales-case-header">
              <div>
                <h3>{customerCaseReasonLabel[item.reason as CaseReason]}</h3>
                <small>
                  Case {item.caseNumber} · reported {etDateTime(item.createdAt)}
                </small>
              </div>
              <span
                className={`after-sales-status after-sales-status-${item.status}`}
              >
                {item.status === "open" ? "Open" : "Closed"}
              </span>
            </header>
            <p className="after-sales-next-step" role="status">
              {customerCaseNextStep(item, caseRas, caseReceipts)}
            </p>
            {refunds.length > 0 && (
              <section className="after-sales-case-section">
                <h4>Refund</h4>
                {refunds.map((refund) => (
                  <div key={refund.id} className="after-sales-refund-summary">
                    <p>
                      <strong>
                        {refund.sourceKind === "supplemental"
                          ? "Supplemental refund · "
                          : ""}
                        {usd(refund.refundCents)}
                      </strong>{" "}
                      · {refundStatusLabel(refund, "en")}
                    </p>
                    <details>
                      <summary>Refund breakdown</summary>
                      <RefundBreakdown refund={refund} language="en" />
                      <p>
                        Refunds are initiated through your original payment
                        channel where possible. We can&apos;t promise when your
                        bank or PayPal will post the funds.
                      </p>
                    </details>
                    <CustomerRefundResponse
                      refund={refund}
                      commandId={commandId}
                      busy={busy}
                    />
                  </div>
                ))}
              </section>
            )}
            {openRas.length > 0 && item.status === "open" && (
              <section className="after-sales-case-section">
                <h4>Return instructions</h4>
                <CustomerReturnAuthorizations
                  ras={openRas}
                  lineName={lineName}
                />
              </section>
            )}
            <section className="after-sales-case-section">
              <h4>Items</h4>
              <ul className="after-sales-line-list">
                {item.lines.map((line) => (
                  <li key={`${line.lineId}:${line.shipmentId}`}>
                    {line.displayName} × {line.physicalQuantity} · delivered{" "}
                    {etDisplayDate(line.deliveredDateEt)}
                  </li>
                ))}
              </ul>
            </section>
            <section className="after-sales-case-section">
              <h4>Progress</h4>
              <ol className="after-sales-timeline">
                <li>
                  <time dateTime={item.createdAt}>
                    {etDateTime(item.createdAt)}
                  </time>
                  <p>
                    <strong>You reported:</strong> {item.description}
                  </p>
                  {reportedFiles.length > 0 && (
                    <ul className="after-sales-file-links">
                      {reportedFiles.map((file) => (
                        <li key={file.id}>
                          <a href={fileHref(file.id)}>
                            <Paperclip size={14} aria-hidden="true" />
                            {file.filename}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
                {item.events.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.createdAt}>
                      {etDateTime(event.createdAt)}
                    </time>
                    <p>{event.body}</p>
                    {event.fileIds.length > 0 && (
                      <ul className="after-sales-file-links">
                        {event.fileIds.map((fileId) => (
                          <li key={fileId}>
                            <a href={fileHref(fileId)}>
                              <Paperclip size={14} aria-hidden="true" />
                              {fileName(fileId)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
            <Link className="button button-secondary" to={messageHref(item.id)}>
              <MessagesSquare size={17} aria-hidden="true" />
              Message us about this case
            </Link>
          </article>
        );
      })}
    </div>
  );
}
