import { ArrowLeft } from "lucide-react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
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
import { createShipmentReadyScheduleService } from "../../shipment/application/shipment-ready-schedule-service";
import { createShipmentMilestoneService } from "../../shipment/application/shipment-milestone-service";
import {
  CustomerShipmentCards,
  customerOrderProgress,
} from "../../shipment/ui/customer-shipment-cards";
import { createOrderShippingChangeService } from "../../shipment/application/order-shipping-change-service";
import {
  CustomerOrderShippingChanges,
  CustomerShippingChangeActions,
} from "../../shipment/ui/customer-order-shipping-changes";

export const headers = piPrivateHeaders;
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareContext);
  const profileId = await piCustomerProfile(env, request);
  const order = await confirmedOrders(env).customerRead(
    profileId,
    piRouteId(params.orderId),
  );
  const [drafts, shipmentPlan, readySchedules, milestones, shippingChanges] =
    await Promise.all([
      followOnQuotes(env).customerListForOrder(profileId, order.id),
      shipmentPlans(env).customerRead(profileId, order.id),
      createShipmentReadyScheduleService(env.DB).customerRead(
        profileId,
        order.id,
      ),
      createShipmentMilestoneService(env.DB).customerRead(profileId, order.id),
      createOrderShippingChangeService(env.DB).customerRead(
        profileId,
        order.id,
      ),
    ]);
  return data(
    {
      order,
      drafts,
      shipmentPlan,
      readySchedules,
      milestones,
      shippingChanges,
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
  const intent = String(form.get("intent") ?? "follow-on");
  if (intent.startsWith("shipping-change-")) {
    const changes = createOrderShippingChangeService(env.DB, {
      auditIp: request.headers.get("cf-connecting-ip") ?? "local",
    });
    try {
      if (intent === "shipping-change-submit") {
        const kind = String(form.get("kind") ?? "");
        const shipmentIds = form.getAll("shipmentId").map(String);
        await changes.customerSubmit(profileId, {
          orderId,
          kind: kind as "delivery_address" | "shipping_plan",
          requested: {
            note: String(form.get("note") ?? ""),
            ...(kind === "delivery_address"
              ? {
                  destination: {
                    recipientName: String(form.get("recipientName") ?? ""),
                    addressLine1: String(form.get("addressLine1") ?? ""),
                    addressLine2: String(form.get("addressLine2") ?? ""),
                    city: String(form.get("city") ?? ""),
                    stateProvince: String(form.get("stateProvince") ?? ""),
                    postalCode: String(form.get("postalCode") ?? ""),
                    countryCode: String(form.get("countryCode") ?? ""),
                    recipientPhone: String(form.get("recipientPhone") ?? ""),
                    recipientEmail: String(form.get("recipientEmail") ?? ""),
                  },
                }
              : {}),
          },
          shipments: shipmentIds.map((shipmentId) => ({
            shipmentId,
            expectedVersion: Number(form.get(`shipmentVersion:${shipmentId}`)),
          })),
          commandId,
        });
      } else if (intent === "shipping-change-accept") {
        if (form.get("acceptTerms") !== "on")
          throw new Response("Please accept the current change version", {
            status: 400,
          });
        await changes.customerAccept(profileId, {
          orderId,
          requestId: String(form.get("requestId") ?? ""),
          proposalId: String(form.get("proposalId") ?? ""),
          proposalHash: String(form.get("proposalHash") ?? ""),
          expectedVersion: Number(form.get("expectedVersion")),
          commandId,
        });
      } else if (intent === "shipping-change-withdraw") {
        await changes.customerWithdraw(profileId, {
          orderId,
          requestId: String(form.get("requestId") ?? ""),
          expectedVersion: Number(form.get("expectedVersion")),
          reason: String(form.get("reason") ?? ""),
          commandId,
        });
      } else throw new Response("Invalid operation", { status: 400 });
    } catch (error) {
      if (error instanceof Response && ![400, 409].includes(error.status))
        throw error;
      return data(
        {
          intent,
          error:
            error instanceof Response && error.status === 409
              ? "This change or shipment has changed. Refresh and review the latest details."
              : "Check the selected shipments and required details.",
        },
        {
          status: error instanceof Response ? error.status : 400,
          headers: headers(),
        },
      );
    }
    return redirect(`/account/orders/${encodeURIComponent(orderId)}`);
  }
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
  const {
    order,
    drafts,
    shipmentPlan,
    readySchedules,
    milestones,
    shippingChanges,
    commandId,
  } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const snapshot = order.snapshot;
  const address = snapshot.destination;
  const progress = customerOrderProgress(shipmentPlan, milestones);
  const orderShipments = shipmentPlan.shipments.map((shipment) => ({
    id: shipment.id,
    displayName: shipment.displayName,
    status: shipment.status,
    version: shipment.version,
    held: shipment.held,
  }));
  return (
    <AccountWorkspace activeView="orders">
      <main className="account-detail-content customer-quote-detail customer-order-detail">
        <Link className="customer-quote-back-link" to="/account?view=orders">
          <ArrowLeft size={17} />
          Back to Orders
        </Link>
        <header className="customer-order-hero">
          <div>
            <span className="eyebrow">Order {order.orderNumber}</span>
            <h1>
              {order.status === "Payment Review Hold"
                ? "Payment under review"
                : progress.headline}
            </h1>
            <p>
              {progress.summary} · Confirmed{" "}
              {formatPiDate(order.confirmedAt, "customer")}
            </p>
          </div>
          <strong className="customer-order-total">
            USD {(order.totalCents / 100).toFixed(2)}
          </strong>
        </header>
        <CustomerShippingChangeActions
          shipments={orderShipments}
          destination={snapshot.destination}
          commandId={commandId}
          actionData={
            actionData?.intent === "shipping-change-submit"
              ? actionData
              : undefined
          }
        />
        {order.status === "Payment Review Hold" && (
          <p className="shipment-card-status" role="status">
            Payment is under review. The order is preserved, but further release
            is paused. Please contact Support.
          </p>
        )}
        <CustomerShipmentCards
          plan={shipmentPlan}
          milestones={milestones}
          schedules={readySchedules}
        />
        <CustomerOrderShippingChanges
          changes={shippingChanges}
          shipments={orderShipments}
          commandId={commandId}
          busy={navigation.state !== "idle"}
          error={
            actionData?.intent === "shipping-change-submit"
              ? undefined
              : actionData?.error
          }
        />
        <section className="customer-quote-section customer-order-details">
          <div className="customer-order-section-heading">
            <h2>Order details</h2>
            <Link
              to={`/account/quotes/${encodeURIComponent(order.requestId)}/pi/${encodeURIComponent(order.piId)}`}
            >
              View accepted PI
            </Link>
          </div>
          {snapshot.lines.map((line) => (
            <ConfirmedOrderLine key={line.id} line={line} />
          ))}
          <dl className="customer-order-facts">
            <div>
              <dt>Order total</dt>
              <dd>USD {(order.totalCents / 100).toFixed(2)}</dd>
            </div>
            <div>
              <dt>Terms</dt>
              <dd>
                {snapshot.terms.incoterm} · {snapshot.terms.namedPlace} ·{" "}
                {snapshot.terms.transportMethod}
              </dd>
            </div>
            <div>
              <dt>Lead time</dt>
              <dd>{snapshot.terms.leadTime}</dd>
            </div>
            <div>
              <dt>Delivery destination</dt>
              <dd>
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
              </dd>
            </div>
          </dl>
        </section>
        <section className="customer-quote-section">
          <h2>Need more products?</h2>
          <p>
            Additional items are quoted separately and don&apos;t change this
            order.
          </p>
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
      </main>
    </AccountWorkspace>
  );
}
