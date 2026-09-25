import { Link } from "react-router";
import { ChevronRight, Package } from "lucide-react";
import type {
  createConfirmedOrderService,
  CustomerOrderStage,
} from "../../proforma-invoice/application/confirmed-order-service";
import { customerCalendarDate } from "../../shipment/domain/ready-schedule";
import { hoseMediaPath } from "../../storefront/ui/catalog-media";

type OrderList = Awaited<
  ReturnType<ReturnType<typeof createConfirmedOrderService>["customerList"]>
>;
type Order = OrderList["records"][number];

export const customerOrderTabs = [
  { code: "all", label: "All orders" },
  { code: "processing", label: "Processing" },
  { code: "ready", label: "Ready to ship" },
  { code: "shipped", label: "Shipped" },
  { code: "delivered", label: "Delivered" },
] as const satisfies ReadonlyArray<{
  code: CustomerOrderStage | "all";
  label: string;
}>;
export type CustomerOrderTab = (typeof customerOrderTabs)[number]["code"];

const stageIndex: Record<CustomerOrderStage, number> = {
  processing: 0,
  ready: 1,
  shipped: 2,
  delivered: 3,
};

const confirmedDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
});

function badge(order: Order) {
  if (order.status === "Payment Review Hold")
    return { label: "Payment under review", tone: "hold" };
  if (order.stage === "shipped" && order.shippedCount < order.shipmentCount)
    return { label: "Partially shipped", tone: "shipped" };
  return {
    label: customerOrderTabs.find((tab) => tab.code === order.stage)!.label,
    tone: order.stage,
  };
}

function progressText(order: Order) {
  if (order.status === "Payment Review Hold")
    return "Payment is under review. Contact Support for details.";
  if (order.shipmentPlanStatus === "review")
    return "We're confirming your shipment plan.";
  const shipments = order.shipmentCount;
  if (order.stage === "delivered")
    return order.lastDeliveredDate
      ? `Delivered ${customerCalendarDate(order.lastDeliveredDate)}`
      : "Delivered";
  if (order.stage === "shipped")
    return shipments > 1
      ? `${order.shippedCount} of ${shipments} shipments shipped${order.deliveredCount ? ` · ${order.deliveredCount} delivered` : ""}`
      : "On the way. Tracking is on the order page.";
  if (order.stage === "ready")
    return "Ready to ship. Tracking follows after carrier handoff.";
  return order.nextReadyDate
    ? `Estimated ready to ship ${customerCalendarDate(order.nextReadyDate)}`
    : "We're preparing your order.";
}

function OrderCard({ order }: { order: Order }) {
  const line = order.firstLine;
  const image =
    line?.imageUrl ||
    (line?.hoseMediaKey ? hoseMediaPath(line.hoseMediaKey) : null);
  const status = badge(order);
  const reached = stageIndex[order.stage];
  return (
    <article className="customer-order-card">
      <Link
        to={`/account/orders/${encodeURIComponent(order.id)}`}
        className="customer-order-card-link"
        aria-label={`View order ${order.orderNumber}, ${status.label}`}
      >
        <span className="customer-order-thumb" aria-hidden="true">
          {image ? <img src={image} alt="" /> : <Package size={26} />}
        </span>
        <span className="customer-order-card-body">
          <span className="customer-order-card-top">
            <strong className="customer-order-number">
              {order.orderNumber}
            </strong>
            <span className={`customer-order-badge ${status.tone}`}>
              {status.label}
            </span>
          </span>
          <span className="customer-order-product">
            {line?.displayName ?? "Order items"}
            {order.lineCount > 1 &&
              ` + ${order.lineCount - 1} more item${order.lineCount === 2 ? "" : "s"}`}
          </span>
          <span className="customer-order-meta">
            Confirmed {confirmedDate.format(new Date(order.confirmedAt))} · USD{" "}
            {(order.totalCents / 100).toFixed(2)}
          </span>
          <span className="customer-order-progress">
            <span className="customer-order-progress-bar" aria-hidden="true">
              {[0, 1, 2, 3].map((step) => (
                <span key={step} data-complete={step <= reached} />
              ))}
            </span>
            {progressText(order)}
          </span>
        </span>
        <ChevronRight
          className="customer-order-chevron"
          size={20}
          aria-hidden="true"
        />
      </Link>
    </article>
  );
}

export function CustomerOrderList({
  orders,
  selected,
}: {
  orders: OrderList;
  selected: CustomerOrderTab;
}) {
  const tabHref = (code: CustomerOrderTab) =>
    code === "all"
      ? "/account?view=orders"
      : `/account?view=orders&status=${code}`;
  return (
    <section className="account-record-detail customer-order-list-page">
      <span className="eyebrow">Purchases</span>
      <h1>Orders</h1>
      <nav className="customer-quote-tabs" aria-label="Order status">
        {customerOrderTabs.map((tab) => (
          <Link
            key={tab.code}
            to={tabHref(tab.code)}
            aria-current={selected === tab.code ? "page" : undefined}
            preventScrollReset
          >
            <span className="customer-quote-tab-label" data-label={tab.label}>
              <span>{tab.label}</span>
            </span>
            <span className="customer-quote-tab-count">
              {orders.counts[tab.code]}
            </span>
          </Link>
        ))}
      </nav>
      {orders.records.length === 0 ? (
        <div className="customer-order-empty">
          {selected === "all" ? (
            <>
              <p>No confirmed orders yet.</p>
              <p>
                Orders appear here after you accept a PI and payment clears.{" "}
                <Link to="/account?view=my-quotes">View your quotes</Link>
              </p>
            </>
          ) : (
            <p>
              No orders are{" "}
              {customerOrderTabs
                .find((tab) => tab.code === selected)!
                .label.toLowerCase()}{" "}
              right now.
            </p>
          )}
        </div>
      ) : (
        <div className="customer-order-list">
          {orders.records.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
      {orders.nextCursor && (
        <Link
          className="button button-secondary"
          to={`${tabHref(selected)}&before=${encodeURIComponent(orders.nextCursor)}`}
        >
          Older orders
        </Link>
      )}
    </section>
  );
}
