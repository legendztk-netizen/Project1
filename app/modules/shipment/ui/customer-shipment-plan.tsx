import { Link } from "react-router";
import type { createShipmentPlanService } from "../application/shipment-plan-service";

type Plan = Awaited<
  ReturnType<ReturnType<typeof createShipmentPlanService>["customerRead"]>
>;

const statusLabels = {
  planned: "Order Confirmed",
  ready_to_ship: "Ready to Ship",
  shipped: "Shipped",
  delivered: "Delivered",
} as const;

export function CustomerShipmentPlan({ plan }: { plan: Plan }) {
  return (
    <section className="customer-quote-section customer-shipment-plan">
      <h2>Shipments</h2>
      {plan.status === "review" ? (
        <p>
          Your accepted shipment arrangement is being reviewed. No shipment
          dates or carrier handoff are recorded yet.
        </p>
      ) : (
        <p>
          {plan.shipments.length} planned shipment
          {plan.shipments.length === 1 ? "" : "s"}. Preparation and inspection
          are handled before dispatch.
        </p>
      )}
      {plan.originalMode === "split" && plan.originalSplitPlan && (
        <p>Accepted split plan: {plan.originalSplitPlan}</p>
      )}
      <div className="customer-shipment-list">
        {plan.shipments.map((shipment) => (
          <article key={shipment.id} className="customer-shipment-item">
            <div className="customer-shipment-heading">
              <h3>
                Shipment {shipment.sequenceNumber} · {shipment.displayName}
              </h3>
              <strong>{statusLabels[shipment.status]}</strong>
            </div>
            {shipment.held && (
              <p role="status">
                Release is currently on hold. Contact Support for details.
              </p>
            )}
            <p>
              {shipment.incoterm} · {shipment.namedPlace} ·{" "}
              {shipment.transportMethod}
            </p>
            <p>
              Deliver to {shipment.destination.recipientName} ·{" "}
              {shipment.destination.addressLine1}, {shipment.destination.city},{" "}
              {shipment.destination.stateProvince}{" "}
              {shipment.destination.postalCode}
            </p>
            <ul>
              {shipment.allocations.map((allocation) => (
                <li key={allocation.lineId}>
                  <span>
                    {allocation.displayName} · {allocation.sku}
                  </span>
                  <strong>
                    {allocation.physicalQuantity} {allocation.unit}
                    {allocation.lengthPerPiece &&
                      ` · ${allocation.lengthPerPiece.value} ${allocation.lengthPerPiece.unit} each`}
                  </strong>
                </li>
              ))}
            </ul>
            {shipment.allocations.length === 0 && (
              <p>Allocation is pending review.</p>
            )}
            <Link
              to={`/account/orders/${encodeURIComponent(plan.orderId)}/shipments/${encodeURIComponent(shipment.id)}/documents`}
            >
              Shared documents
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
