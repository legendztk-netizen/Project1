import { Link } from "react-router";
import { ExternalLink, FileText } from "lucide-react";
import type { createShipmentMilestoneService } from "../application/shipment-milestone-service";
import type { createShipmentPlanService } from "../application/shipment-plan-service";
import type { createShipmentReadyScheduleService } from "../application/shipment-ready-schedule-service";
import {
  customerCalendarDate,
  readyScheduleText,
} from "../domain/ready-schedule";
import { completedStage, formatPhysicalQuantity } from "./shipment-display";
import { ShipmentStepper } from "./shipment-stepper";
import "./shipment-documents.css";

type Plan = Awaited<
  ReturnType<ReturnType<typeof createShipmentPlanService>["customerRead"]>
>;
type Milestone = Awaited<
  ReturnType<ReturnType<typeof createShipmentMilestoneService>["customerRead"]>
>[number];
type Schedule = Awaited<
  ReturnType<
    ReturnType<typeof createShipmentReadyScheduleService>["customerRead"]
  >
>[number];

const stageLabels = [
  "Order Confirmed",
  "Ready to Ship",
  "Shipped",
  "Delivered",
] as const;

function reviewPending(item?: Milestone) {
  return !!item && "releaseReviewPending" in item && item.releaseReviewPending;
}

export function customerOrderProgress(
  plan: Plan,
  milestones: Milestone[],
): { headline: string; summary: string } {
  const total = milestones.length;
  const shipped = milestones.filter((item) =>
    ["shipped", "delivered"].includes(item.status),
  ).length;
  const delivered = milestones.filter(
    (item) => item.status === "delivered",
  ).length;
  const ready = milestones.filter(
    (item) => item.status === "ready_to_ship" && !reviewPending(item),
  ).length;
  const summary = total
    ? `${shipped} of ${total} shipment${total === 1 ? "" : "s"} shipped · ${delivered} delivered`
    : "Shipment plan pending";
  if (plan.status === "review")
    return { headline: "Confirming your shipment plan", summary };
  if (total && delivered === total) return { headline: "Delivered", summary };
  if (total && shipped === total) return { headline: "On the way", summary };
  if (shipped) return { headline: "Partially shipped", summary };
  if (ready) return { headline: "Ready to ship", summary };
  return { headline: "Preparing your order", summary };
}

function ReadyDate({ schedule }: { schedule: Schedule }) {
  return (
    <>
      {schedule.currentEstimateDate
        ? customerCalendarDate(schedule.currentEstimateDate)
        : "To be confirmed"}
      {schedule.fromOrderChange &&
        schedule.currentEstimateSource === "operational" &&
        " (initial date agreed in Order Change Confirmation)"}
      {!schedule.fromOrderChange &&
        schedule.currentEstimateSource === "operational" &&
        " (new operational estimate, not an original PI commitment)"}
      {schedule.currentEstimateSource === "revised" && " (updated)"}
    </>
  );
}

function ReadyDateBasis({ schedule }: { schedule: Schedule }) {
  return (
    <>
      <p>
        {schedule.fromOrderChange
          ? "This shipment was created by an accepted Order Change Confirmation; the original PI is unchanged."
          : !schedule.acceptedBasis
            ? "No structured date was recorded in the accepted PI."
            : schedule.acceptedBasis.kind === "china_business_days"
              ? `Accepted basis: ${readyScheduleText(schedule.acceptedBasis)}`
              : "Accepted basis: fixed date in the PI"}
      </p>
      {schedule.acceptedBasis?.kind === "fixed_date" &&
        schedule.acceptedReadyDate &&
        !schedule.currentEstimateDate && (
          <p>
            The original fixed date had passed at Order confirmation; a current
            estimate is under review.
          </p>
        )}
      {(schedule.acceptedReadyDate || schedule.history.length > 0) && (
        <ol>
          {schedule.acceptedReadyDate && (
            <li>
              Accepted date: {customerCalendarDate(schedule.acceptedReadyDate)}
            </li>
          )}
          {schedule.history.map((revision) => (
            <li key={revision.id}>
              {revision.previousDate
                ? customerCalendarDate(revision.previousDate)
                : "Not recorded"}{" "}
              → {customerCalendarDate(revision.newDate)}: {revision.reason}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function CustomerShipmentCards({
  plan,
  milestones,
  schedules,
}: {
  plan: Plan;
  milestones: Milestone[];
  schedules: Schedule[];
}) {
  return (
    <section className="customer-quote-section">
      <h2>Shipments</h2>
      {plan.status === "review" && (
        <p>
          Your accepted shipment arrangement is being reviewed. No shipment
          dates or carrier handoff are recorded yet.
        </p>
      )}
      {plan.originalMode === "split" && plan.originalSplitPlan && (
        <p>Accepted split plan: {plan.originalSplitPlan}</p>
      )}
      <div className="customer-shipment-list">
        {plan.shipments.map((shipment) => {
          const item = milestones.find((row) => row.shipmentId === shipment.id);
          const schedule = schedules.find(
            (row) => row.shipmentId === shipment.id,
          );
          const status = item?.status ?? shipment.status;
          const pending = reviewPending(item);
          const held = shipment.held && status !== "delivered";
          const stage = completedStage(status, pending);
          const destination = shipment.destination;
          return (
            <article
              key={shipment.id}
              className="shipment-card"
              aria-labelledby={`shipment-${shipment.id}`}
            >
              <header className="shipment-card-heading">
                <div>
                  <h3 id={`shipment-${shipment.id}`}>
                    Shipment {shipment.sequenceNumber}
                    {plan.shipments.length > 1 && ` · ${shipment.displayName}`}
                  </h3>
                  <p>
                    {shipment.incoterm} · {shipment.namedPlace} ·{" "}
                    {shipment.transportMethod}
                  </p>
                </div>
                <span className={`orders-status ${held ? "hold" : ""}`}>
                  {held ? "On hold" : stageLabels[stage]}
                </span>
              </header>
              <ShipmentStepper labels={stageLabels} completed={stage} />
              {held && (
                <p className="shipment-card-status" role="status">
                  This shipment has a review hold. Please contact Support for
                  details.
                </p>
              )}
              {pending && (
                <p className="shipment-card-status" role="status">
                  Shipment readiness is being rechecked after an accepted
                  change. Carrier handoff is not yet authorized.
                </p>
              )}
              {!held && !pending && status === "ready_to_ship" && (
                <p className="shipment-card-status">
                  No action is needed from you. Tracking follows after carrier
                  handoff.
                </p>
              )}
              {status === "shipped" &&
                !item?.tracking.some((record) => record.trackingUrl) && (
                  <p className="shipment-card-status">
                    Tracking pending. The carrier handoff has been recorded.
                  </p>
                )}
              {schedule && ["planned", "ready_to_ship"].includes(status) && (
                <div className="shipment-card-row">
                  <span className="shipment-card-label">Est. ready</span>
                  <strong>
                    <ReadyDate schedule={schedule} />
                  </strong>
                </div>
              )}
              {!!item?.tracking.length && (
                <div className="shipment-card-row">
                  <span className="shipment-card-label">Tracking</span>
                  <ul className="shipment-card-tracking">
                    {item.tracking.map((record) => (
                      <li key={record.id}>
                        <span>
                          {record.packageLabel} · {record.carrierName}
                          {record.trackingNumber
                            ? ` · ${record.trackingNumber}`
                            : ""}
                          {record.estimatedArrivalDate
                            ? ` · Estimated arrival ${customerCalendarDate(record.estimatedArrivalDate)}`
                            : ""}
                        </span>
                        {record.trackingUrl && (
                          <a
                            className="shipment-link-button"
                            href={record.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Track shipment{" "}
                            <ExternalLink size={14} aria-hidden="true" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="shipment-card-row shipment-card-items">
                <span className="shipment-card-label">Items</span>
                <ul>
                  {shipment.allocations.map((allocation) => (
                    <li key={allocation.lineId}>
                      <span>
                        {allocation.displayName} · {allocation.sku}
                      </span>
                      <strong>
                        {formatPhysicalQuantity(allocation, "en")}
                      </strong>
                    </li>
                  ))}
                </ul>
                {shipment.allocations.length === 0 && (
                  <span className="shipment-card-muted">
                    Allocation is pending review.
                  </span>
                )}
              </div>
              <div className="shipment-card-row">
                <span className="shipment-card-label">Ship to</span>
                <span>
                  {destination.recipientName} · {destination.addressLine1},{" "}
                  {destination.city}, {destination.stateProvince}{" "}
                  {destination.postalCode}
                </span>
              </div>
              <footer className="shipment-card-footer">
                <Link
                  className="button button-secondary"
                  to={`/account/orders/${encodeURIComponent(plan.orderId)}/shipments/${encodeURIComponent(shipment.id)}/documents`}
                >
                  <FileText size={16} aria-hidden="true" /> Shared documents
                </Link>
                {(schedule || !!item?.events.length) && (
                  <details className="shipment-card-more">
                    <summary>View date and milestone history</summary>
                    {schedule && <ReadyDateBasis schedule={schedule} />}
                    {!!item?.events.length && (
                      <ol>
                        {item.events.map((event) => (
                          <li key={event.kind}>
                            {event.kind === "ready_to_ship"
                              ? "Ready to Ship"
                              : event.kind === "shipped"
                                ? "Shipped"
                                : "Delivered"}
                            {event.actualDate
                              ? ` · ${customerCalendarDate(event.actualDate)}`
                              : ""}
                          </li>
                        ))}
                      </ol>
                    )}
                  </details>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
