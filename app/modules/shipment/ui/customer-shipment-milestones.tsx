import type { createShipmentMilestoneService } from "../application/shipment-milestone-service";
import { customerCalendarDate } from "../domain/ready-schedule";
import "./shipment-documents.css";

type Milestone = Awaited<
  ReturnType<ReturnType<typeof createShipmentMilestoneService>["customerRead"]>
>[number];

const stages = [
  "Order Confirmed",
  "Ready to Ship",
  "Shipped",
  "Delivered",
] as const;

function reviewPending(item: Milestone) {
  return "releaseReviewPending" in item && item.releaseReviewPending;
}

function currentStage(item: Milestone) {
  return item.status === "planned" || reviewPending(item)
    ? 0
    : item.status === "ready_to_ship"
      ? 1
      : item.status === "shipped"
        ? 2
        : 3;
}

export function CustomerShipmentMilestones({
  milestones,
  heldShipmentIds,
}: {
  milestones: Milestone[];
  heldShipmentIds: string[];
}) {
  if (!milestones.length) return null;
  const shipped = milestones.filter((item) =>
    ["shipped", "delivered"].includes(item.status),
  ).length;
  const delivered = milestones.filter(
    (item) => item.status === "delivered",
  ).length;
  return (
    <section className="customer-quote-section shipment-milestones">
      <h2>Order progress</h2>
      <p>
        {delivered} of {milestones.length} shipments delivered · {shipped}{" "}
        handed to a carrier
      </p>
      <div className="shipment-milestone-list">
        {milestones.map((item) => (
          <article key={item.shipmentId}>
            <h3>{item.displayName}</h3>
            <ol className="shipment-progress-stages">
              {stages.map((stage, index) => (
                <li key={stage} data-complete={index <= currentStage(item)}>
                  {stage}
                </li>
              ))}
            </ol>
            {heldShipmentIds.includes(item.shipmentId) &&
              item.status !== "delivered" && (
                <p role="status">
                  This shipment has a review hold. Please contact Support for
                  details.
                </p>
              )}
            {reviewPending(item) && (
              <p role="status">
                Shipment readiness is being rechecked after an accepted change.
                Carrier handoff is not yet authorized.
              </p>
            )}
            {item.status === "ready_to_ship" && !reviewPending(item) && (
              <p>
                No action is needed from you. Tracking follows after carrier
                handoff.
              </p>
            )}
            {item.status === "shipped" &&
              !item.tracking.some((record) => record.trackingUrl) && (
                <p>Tracking pending. The carrier handoff has been recorded.</p>
              )}
            {!!item.tracking.length && (
              <ul className="shipment-tracking-list">
                {item.tracking.map((record) => (
                  <li key={record.id}>
                    {record.packageLabel} · {record.carrierName}
                    {record.trackingNumber ? ` · ${record.trackingNumber}` : ""}
                    {record.estimatedArrivalDate
                      ? ` · Estimated arrival ${customerCalendarDate(record.estimatedArrivalDate)}`
                      : ""}
                    {record.trackingUrl && (
                      <a
                        href={record.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Track shipment
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {item.events.length > 0 && (
              <details>
                <summary>View milestone history</summary>
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
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
