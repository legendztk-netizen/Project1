import { ArrowLeft } from "lucide-react";
import {
  data,
  Form,
  Link,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { cloudflareContext } from "#workers/context";
import {
  confirmedOrders,
  followOnQuotes,
  piCustomerProfile,
  piPrivateHeaders,
  piRouteId,
  shipmentPlans,
} from "#workers/proforma-invoice";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import { ConfirmedOrderLine } from "../../proforma-invoice/ui/confirmed-order-line";
import { AccountWorkspace } from "../ui/account-workspace";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";
import { CustomerShipmentPlan } from "../../shipment/ui/customer-shipment-plan";
import { createShipmentReadyScheduleService } from "../../shipment/application/shipment-ready-schedule-service";
import { CustomerShipmentReadySchedules } from "../../shipment/ui/customer-shipment-ready-schedules";
import { createShipmentMilestoneService } from "../../shipment/application/shipment-milestone-service";
import { CustomerShipmentMilestones } from "../../shipment/ui/customer-shipment-milestones";

export const headers = piPrivateHeaders;
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareContext);
  const profileId = await piCustomerProfile(env, request);
  const order = await confirmedOrders(env).customerRead(
    profileId,
    piRouteId(params.orderId),
  );
  const [drafts, shipmentPlan, readySchedules, milestones] = await Promise.all([
    followOnQuotes(env).customerListForOrder(profileId, order.id),
    shipmentPlans(env).customerRead(profileId, order.id),
    createShipmentReadyScheduleService(env.DB).customerRead(
      profileId,
      order.id,
    ),
    createShipmentMilestoneService(env.DB).customerRead(profileId, order.id),
  ]);
  return data(
    {
      order,
      drafts,
      shipmentPlan,
      readySchedules,
      milestones,
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { env, runtime } = context.get(cloudflareContext);
  requireTrustedAuthPost({
    environment: runtime.environment,
    request,
    storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
  });
  const profileId = await piCustomerProfile(env, request);
  const orderId = piRouteId(params.orderId);
  await confirmedOrders(env).customerRead(profileId, orderId);
  const form = await request.formData();
  const commandId = String(form.get("commandId") ?? "");
  const draft = await followOnQuotes(env).customerCreate(
    profileId,
    orderId,
    commandId,
  );
  return redirect(
    `/quote-list?followOnDraftId=${encodeURIComponent(draft.id)}`,
  );
}

export default function ConfirmedOrderDetail({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>["data"];
}) {
  const { order, drafts, shipmentPlan, readySchedules, milestones, commandId } =
    loaderData;
  const snapshot = order.snapshot;
  const address = snapshot.destination;
  return (
    <AccountWorkspace activeView="orders">
      <main className="account-detail-content customer-quote-detail">
        <Link className="customer-quote-back-link" to="/account?view=orders">
          <ArrowLeft size={17} />
          Back to Orders
        </Link>
        <span className="eyebrow">{order.status}</span>
        <h1 className="confirmed-order-number">{order.orderNumber}</h1>
        <p>Confirmed {formatPiDate(order.confirmedAt, "customer")}</p>
        {order.status === "Payment Review Hold" && (
          <p role="status">
            Payment is under review. The order is preserved, but further release
            is paused. Please contact Support.
          </p>
        )}
        <Link
          to={`/account/quotes/${encodeURIComponent(order.requestId)}/pi/${encodeURIComponent(order.piId)}`}
        >
          View accepted PI
        </Link>
        <section className="customer-quote-section">
          <h2>Additional purchases</h2>
          <Form method="post">
            <input type="hidden" name="commandId" value={commandId} />
            <button className="button button-secondary">
              Start a follow-on quote
            </button>
          </Form>
          {drafts.map((draft) => (
            <p key={draft.id}>
              {draft.submittedRequestId ? (
                <Link
                  to={`/account/quotes/${encodeURIComponent(draft.submittedRequestId)}`}
                >
                  View follow-on request
                </Link>
              ) : (
                <Link
                  to={`/quote-list?followOnDraftId=${encodeURIComponent(draft.id)}`}
                >
                  Continue follow-on draft
                </Link>
              )}
            </p>
          ))}
        </section>
        <section className="customer-quote-section">
          <h2>Order total</h2>
          <p>USD {(order.totalCents / 100).toFixed(2)}</p>
          <p>
            {snapshot.terms.incoterm} · {snapshot.terms.namedPlace} ·{" "}
            {snapshot.terms.transportMethod}
          </p>
        </section>
        <CustomerShipmentPlan plan={shipmentPlan} />
        <CustomerShipmentMilestones
          milestones={milestones}
          heldShipmentIds={shipmentPlan.shipments
            .filter((item) => item.held)
            .map((item) => item.id)}
        />
        <CustomerShipmentReadySchedules schedules={readySchedules} />
        {snapshot.lines.map((line) => (
          <ConfirmedOrderLine key={line.id} line={line} />
        ))}
        <section className="customer-quote-section">
          <h2>Delivery destination</h2>
          <address>
            {address.recipientName}
            <br />
            {address.addressLine1}
            <br />
            {address.addressLine2 && (
              <>
                {address.addressLine2}
                <br />
              </>
            )}
            {address.city}, {address.stateProvince} {address.postalCode}
            <br />
            {address.countryCode}
          </address>
          <p>Lead time: {snapshot.terms.leadTime}</p>
        </section>
      </main>
    </AccountWorkspace>
  );
}
