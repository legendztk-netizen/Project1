import { useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import {
  ArrowLeft,
  ChevronDown,
  FileText,
  MoreHorizontal,
  Package,
  Plus,
} from "lucide-react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  confirmedOrders,
  followOnQuotes,
  piPrivateHeaders,
  piRouteId,
  shipmentPlans,
} from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  formatPiDate,
  type ProformaInvoiceSnapshot,
} from "../../proforma-invoice/domain/proforma-invoice";
import {
  hoseEndMediaPath,
  hoseMediaPath,
} from "../../storefront/ui/catalog-media";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import "../ui/confirmed-orders.css";
import { AdminShipmentPlan } from "../../shipment/ui/admin-shipment-plan";
import { parseShipmentGroupsForm } from "../../shipment/application/parse-shipment-groups-form";
import { createShipmentReadyScheduleService } from "../../shipment/application/shipment-ready-schedule-service";
import { AdminShipmentReadySchedules } from "../../shipment/ui/admin-shipment-ready-schedules";
import { createShipmentMilestoneService } from "../../shipment/application/shipment-milestone-service";
import { AdminShipmentMilestones } from "../../shipment/ui/admin-shipment-milestones";
import { createOrderShippingChangeService } from "../../shipment/application/order-shipping-change-service";
import { AdminOrderShippingChanges } from "../../shipment/ui/admin-order-shipping-changes";
import { splitShipmentIdForChange } from "../../shipment/domain/order-shipping-change";

export const headers = piPrivateHeaders;

function safeReturnTo(value: string | null) {
  if (!value) return "/admin/orders";
  try {
    const url = new URL(value, "http://local.invalid");
    return url.origin === "http://local.invalid" &&
      url.pathname === "/admin/orders"
      ? `${url.pathname}${url.search}`
      : "/admin/orders";
  } catch {
    return "/admin/orders";
  }
}

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const order = await confirmedOrders(env).adminRead(
    adminIdentity,
    piRouteId(params.orderId),
  );
  const [
    drafts,
    activity,
    shipmentPlan,
    readySchedules,
    milestones,
    shippingChanges,
  ] = await Promise.all([
    followOnQuotes(env).adminListForOrder(adminIdentity, order.id),
    confirmedOrders(env).adminActivity(adminIdentity, order.id),
    shipmentPlans(env).adminRead(adminIdentity, order.id),
    createShipmentReadyScheduleService(env.DB).adminRead(
      adminIdentity,
      order.id,
    ),
    createShipmentMilestoneService(env.DB).adminRead(adminIdentity, order.id),
    createOrderShippingChangeService(env.DB).adminRead(adminIdentity, order.id),
  ]);
  return data(
    {
      order,
      drafts,
      activity,
      shipmentPlan,
      readySchedules,
      milestones,
      shippingChanges,
      milestoneCommands: Object.fromEntries(
        milestones.map((item) => [
          item.shipmentId,
          {
            ready: crypto.randomUUID(),
            shipped: crypto.randomUUID(),
            delivered: crypto.randomUUID(),
            tracking: crypto.randomUUID(),
            lateReport: crypto.randomUUID(),
            lateApply: crypto.randomUUID(),
          },
        ]),
      ),
      trackingCommands: Object.fromEntries(
        milestones.flatMap((item) =>
          item.tracking.map((record) => [record.id, crypto.randomUUID()]),
        ),
      ),
      scheduleCommandIds: Object.fromEntries(
        readySchedules.map((schedule) => [
          schedule.shipmentId,
          crypto.randomUUID(),
        ]),
      ),
      returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")),
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const orderId = piRouteId(params.orderId);
  await confirmedOrders(env).adminRead(adminIdentity, orderId);
  const form = await readPrivateReviewForm(request);
  const intent = String(form.get("intent") ?? "");
  if (intent === "follow-on") {
    await followOnQuotes(env).adminCreate(
      adminIdentity,
      orderId,
      String(form.get("commandId") ?? ""),
    );
  } else if (intent === "shipment-map" || intent === "shipment-revise") {
    try {
      const plan = await shipmentPlans(env).adminRead(adminIdentity, orderId);
      const command = {
        orderId,
        expectedVersion: Number(form.get("expectedVersion")),
        commandId: String(form.get("commandId") ?? ""),
        groups: parseShipmentGroupsForm(
          form,
          plan.lines ?? [],
          plan.originalTerms,
        ),
        reviewNote: String(form.get("reviewNote") ?? ""),
        matchesAcceptedTerms: form.get("matchesAcceptedTerms") === "on",
      };
      if (intent === "shipment-revise")
        await shipmentPlans(env).reviseHistoricalSplit(adminIdentity, command);
      else await shipmentPlans(env).mapHistoricalSplit(adminIdentity, command);
    } catch (error) {
      if (error instanceof Response && ![400, 409].includes(error.status))
        throw error;
      return data(
        {
          error:
            error instanceof Response
              ? await error.text()
              : error instanceof Error
                ? error.message
                : "分批计划保存失败",
        },
        { status: error instanceof Response ? error.status : 400 },
      );
    }
  } else if (intent === "schedule-resolve" || intent === "schedule-revise") {
    try {
      const service = createShipmentReadyScheduleService(env.DB, {
        auditIp: request.headers.get("cf-connecting-ip") ?? "local",
      });
      const command = {
        orderId,
        shipmentId: piRouteId(String(form.get("shipmentId") ?? "")),
        expectedVersion: Number(form.get("expectedVersion")),
        expectedShipmentVersion: Number(form.get("expectedShipmentVersion")),
        commandId: String(form.get("commandId") ?? ""),
      };
      if (intent === "schedule-resolve")
        await service.resolveAccepted(adminIdentity, command);
      else
        await service.revise(adminIdentity, {
          ...command,
          newDate: String(form.get("newDate") ?? ""),
          reason: String(form.get("reason") ?? ""),
        });
    } catch (error) {
      if (error instanceof Response && ![400, 409].includes(error.status))
        throw error;
      return data(
        {
          error:
            error instanceof Response && error.status === 409
              ? "批次日期或审核状态已变化，请刷新后重新核对。"
              : "批次日期保存失败，请检查日期与审核依据。",
        },
        { status: error instanceof Response ? error.status : 400 },
      );
    }
  } else if (
    [
      "milestone-ready",
      "milestone-ship",
      "milestone-deliver",
      "milestone-report-late",
      "milestone-apply-late",
      "tracking-save",
    ].includes(intent)
  ) {
    try {
      const service = createShipmentMilestoneService(env.DB, {
        auditIp: request.headers.get("cf-connecting-ip") ?? "local",
      });
      const input = {
        orderId,
        shipmentId: piRouteId(String(form.get("shipmentId") ?? "")),
        commandId: String(form.get("commandId") ?? ""),
      };
      if (intent === "milestone-ready")
        await service.markReady(adminIdentity, {
          ...input,
          expectedVersion: Number(form.get("expectedVersion")),
          verification: {
            specificationsVerified: form.get("specificationsVerified") === "on",
            quantitiesVerified: form.get("quantitiesVerified") === "on",
            offlinePreparationVerified:
              form.get("offlinePreparationVerified") === "on",
            requiredInspectionVerified:
              form.get("requiredInspectionVerified") === "on",
          },
        });
      else if (intent === "milestone-ship") {
        const handoffAt = Temporal.PlainDateTime.from(
          String(form.get("handoffLocal") ?? ""),
        )
          .toZonedDateTime("Asia/Shanghai")
          .toInstant()
          .toString();
        await service.markShipped(adminIdentity, {
          ...input,
          expectedVersion: Number(form.get("expectedVersion")),
          handoffAt,
          carrierName: String(form.get("carrierName") ?? ""),
          source: String(form.get("source") ?? ""),
        });
      } else if (intent === "milestone-report-late") {
        const handoffAt = Temporal.PlainDateTime.from(
          String(form.get("handoffLocal") ?? ""),
        )
          .toZonedDateTime("Asia/Shanghai")
          .toInstant()
          .toString();
        await service.reportLateHandoff(adminIdentity, {
          ...input,
          expectedVersion: Number(form.get("expectedVersion")),
          handoffAt,
          carrierName: String(form.get("carrierName") ?? ""),
          source: String(form.get("source") ?? ""),
          reason: String(form.get("reason") ?? ""),
        });
      } else if (intent === "milestone-apply-late") {
        await service.applyLateHandoff(adminIdentity, {
          ...input,
          expectedVersion: Number(form.get("expectedVersion")),
          reportId: String(form.get("reportId") ?? ""),
        });
      } else if (intent === "milestone-deliver")
        await service.markDelivered(adminIdentity, {
          ...input,
          expectedVersion: Number(form.get("expectedVersion")),
          actualDate: String(form.get("actualDate") ?? ""),
          source: String(form.get("source") ?? ""),
        });
      else
        await service.saveTracking(adminIdentity, {
          ...input,
          trackingId: String(form.get("trackingId") ?? "") || undefined,
          expectedVersion: Number(form.get("expectedTrackingVersion")),
          packageLabel: String(form.get("packageLabel") ?? ""),
          carrierName: String(form.get("carrierName") ?? ""),
          trackingNumber: String(form.get("trackingNumber") ?? ""),
          trackingUrl: String(form.get("trackingUrl") ?? ""),
          estimatedArrivalDate: String(form.get("estimatedArrivalDate") ?? ""),
          reason: String(form.get("reason") ?? ""),
        });
    } catch (error) {
      if (error instanceof Response && ![400, 409].includes(error.status))
        throw error;
      return data(
        {
          error:
            error instanceof Response && error.status === 409
              ? "批次状态或放行条件已变化，请刷新后核查限制与数量。"
              : "批次状态保存失败，请检查日期、数量和必填凭据。",
        },
        { status: error instanceof Response ? error.status : 400 },
      );
    }
  } else if (intent.startsWith("shipping-change-")) {
    try {
      const service = createOrderShippingChangeService(env.DB, {
        auditIp: request.headers.get("cf-connecting-ip") ?? "local",
      });
      const requestId = String(form.get("requestId") ?? "");
      const expectedVersion = Number(form.get("expectedVersion"));
      const commandId = String(form.get("commandId") ?? "");
      if (intent === "shipping-change-propose") {
        const change = (await service.adminRead(adminIdentity, orderId)).find(
          (item) => item.id === requestId,
        );
        if (!change) throw new Response("变更申请不存在", { status: 404 });
        const plan = await shipmentPlans(env).adminRead(adminIdentity, orderId);
        const affected = change.shipments.map((item) => {
          const shipment = plan.shipments.find(
            (row) => row.id === item.shipmentId,
          );
          if (!shipment) throw new Response("批次已变化", { status: 409 });
          const key = (name: string) =>
            String(form.get(`shipment:${shipment.id}:${name}`) ?? "");
          const lineIds = [
            ...new Set(
              change.shipments.flatMap((row) =>
                row.quantities.map((allocation) => allocation.lineId),
              ),
            ),
          ];
          return {
            shipmentId: shipment.id,
            destination: {
              recipientName: key("recipientName"),
              addressLine1: key("addressLine1"),
              addressLine2: key("addressLine2"),
              city: key("city"),
              stateProvince: key("stateProvince"),
              postalCode: key("postalCode"),
              countryCode: key("countryCode"),
              recipientPhone: key("recipientPhone"),
              recipientEmail: key("recipientEmail"),
            },
            carrierName: key("carrierName"),
            serviceName: key("serviceName"),
            transportMethod: key("transportMethod"),
            incoterm: key("incoterm"),
            namedPlace: key("namedPlace"),
            destinationTaxTreatment: key("destinationTaxTreatment"),
            readyDate: key("readyDate") || null,
            allocations: lineIds
              .map((lineId) => ({
                lineId,
                physicalQuantity: Number(key(`allocation:${lineId}`)),
              }))
              .filter((allocation) => allocation.physicalQuantity > 0),
          };
        });
        if (form.get("createSplitShipment") === "on") {
          if (change.kind !== "shipping_plan" || affected.length === 0)
            throw new Response("仅发货计划变更可新增批次", { status: 400 });
          const source = affected[0];
          const shipmentId = splitShipmentIdForChange(requestId);
          const key = (name: string) =>
            String(form.get(`shipment:${shipmentId}:${name}`) ?? "");
          const lineIds = [
            ...new Set(
              change.shipments.flatMap((item) =>
                item.quantities.map((allocation) => allocation.lineId),
              ),
            ),
          ];
          affected.push({
            shipmentId,
            destination: source.destination,
            carrierName: key("carrierName"),
            serviceName: key("serviceName"),
            transportMethod: key("transportMethod"),
            incoterm: key("incoterm"),
            namedPlace: key("namedPlace"),
            destinationTaxTreatment: key("destinationTaxTreatment"),
            readyDate: key("readyDate") || null,
            allocations: lineIds
              .map((lineId) => ({
                lineId,
                physicalQuantity: Number(key(`allocation:${lineId}`)),
              }))
              .filter((allocation) => allocation.physicalQuantity > 0),
          });
        }
        const amount = String(form.get("adjustmentUsd") ?? "");
        if (!/^-?\d+(\.\d{1,2})?$/.test(amount))
          throw new Response("请输入有效 USD 金额", { status: 400 });
        const negative = amount.startsWith("-");
        const [whole, decimal = ""] = (
          negative ? amount.slice(1) : amount
        ).split(".");
        const cents =
          (Number(whole) * 100 + Number(decimal.padEnd(2, "0"))) *
          (negative ? -1 : 1);
        if (!Number.isSafeInteger(cents))
          throw new Response("金额超出范围", { status: 400 });
        const expiresAt = Temporal.PlainDateTime.from(
          String(form.get("expiresLocal") ?? ""),
        )
          .toZonedDateTime("Asia/Shanghai")
          .toInstant()
          .toString();
        await service.adminPropose(adminIdentity, {
          orderId,
          requestId,
          expectedVersion,
          shipments: affected,
          adjustmentCents: cents,
          reason: String(form.get("reason") ?? ""),
          expiresAt,
          commandId,
        });
      } else if (intent === "shipping-change-apply")
        await service.adminApply(adminIdentity, {
          orderId,
          requestId,
          proposalId: String(form.get("proposalId") ?? ""),
          expectedVersion,
          commandId,
        });
      else if (intent === "shipping-change-decline")
        await service.adminDecline(adminIdentity, {
          orderId,
          requestId,
          expectedVersion,
          commandId,
          reason: String(form.get("reason") ?? ""),
        });
      else if (intent === "shipping-change-reverify")
        await service.adminVerifyRevisedReady(adminIdentity, {
          orderId,
          shipmentId: String(form.get("shipmentId") ?? ""),
          effectiveChangeId: String(form.get("effectiveChangeId") ?? ""),
          expectedShipmentVersion: Number(form.get("expectedShipmentVersion")),
          commandId,
          verification: {
            specificationsVerified: form.get("specificationsVerified") === "on",
            quantitiesVerified: form.get("quantitiesVerified") === "on",
            offlinePreparationVerified:
              form.get("offlinePreparationVerified") === "on",
            requiredInspectionVerified:
              form.get("requiredInspectionVerified") === "on",
          },
        });
      else throw new Response("Invalid operation", { status: 400 });
    } catch (error) {
      if (error instanceof Response && ![400, 409].includes(error.status))
        throw error;
      return data(
        {
          error:
            error instanceof Response && error.status === 409
              ? "变更提案、客户接受或批次状态已变化，请刷新并重新核对。"
              : "请检查变更条款、金额、数量及必填审核信息。",
        },
        { status: error instanceof Response ? error.status : 400 },
      );
    }
  } else throw new Response("Invalid operation", { status: 400 });
  const returnTo = safeReturnTo(
    new URL(request.url).searchParams.get("returnTo"),
  );
  return redirect(
    `/admin/orders/${encodeURIComponent(orderId)}?returnTo=${encodeURIComponent(returnTo)}${intent.startsWith("shipping-change-") ? "&tab=changes" : intent.startsWith("shipment-") || intent.startsWith("schedule-") || intent.startsWith("milestone-") || intent === "tracking-save" ? "&tab=shipments" : ""}`,
  );
}

type Line = ProformaInvoiceSnapshot["lines"][number];
const money = (cents: number | null) =>
  cents === null ? "未记录" : `USD ${(cents / 100).toFixed(2)}`;

function ProductPreview({ line }: { line: Line }) {
  const images = line.assembly
    ? [
        {
          src: hoseEndMediaPath(line.assembly.endA.hoseEnd.mediaKey),
          alt: "End A",
        },
        { src: hoseMediaPath(line.assembly.hose.mediaKey), alt: "Hose" },
        {
          src: hoseEndMediaPath(line.assembly.endB.hoseEnd.mediaKey),
          alt: "End B",
        },
      ]
    : [
        {
          src:
            line.product.mainImageUrl ||
            (line.lineKind === "length_based_hose"
              ? hoseMediaPath(line.product.mediaKey)
              : null),
          alt: line.displayName,
        },
      ];
  return (
    <div
      className="order-line-images"
      data-assembly={!!line.assembly || undefined}
    >
      {images.map((image, index) =>
        image.src ? (
          <img key={index} src={image.src} alt={image.alt} />
        ) : (
          <span key={index} aria-label="暂无商品图片">
            <Package size={22} />
          </span>
        ),
      )}
    </div>
  );
}

function OrderLine({ line }: { line: Line }) {
  return (
    <article className="order-line">
      <div className="order-line-main">
        <ProductPreview line={line} />
        <div className="order-line-title">
          <h3>{line.displayName}</h3>
          <p>SKU {line.sku}</p>
          {line.assembly && (
            <p>
              {line.assembly.endA.hoseEnd.displayName} ·{" "}
              {line.assembly.endB.hoseEnd.displayName} ·{" "}
              {line.assembly.finishedLength.originalValue}{" "}
              {line.assembly.finishedLength.originalUnit}
            </p>
          )}
        </div>
        <div className="order-line-numbers">
          <span>
            {line.quantity} {line.salesUnit}
          </span>
          <span>
            {money(line.price.unitPriceCents)} / {line.salesUnit}
          </span>
          <strong>{money(line.totals.totalCents)}</strong>
        </div>
      </div>
      <details className="order-line-specs">
        <summary>
          查看商品规格与配置 <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <dl className="order-facts">
          {line.lengthOrder && (
            <>
              <div>
                <dt>每件长度</dt>
                <dd>
                  {line.lengthOrder.originalLengthValue}{" "}
                  {line.lengthOrder.originalLengthUnit}
                </dd>
              </div>
              <div>
                <dt>件数</dt>
                <dd>{line.lengthOrder.pieceCount}</dd>
              </div>
              <div>
                <dt>总英尺</dt>
                <dd>{line.lengthOrder.totalFootage} ft</dd>
              </div>
            </>
          )}
          {line.assembly && (
            <>
              <div>
                <dt>胶管</dt>
                <dd>
                  {line.assembly.hose.familyName} · {line.assembly.hose.sku}
                </dd>
              </div>
              <div>
                <dt>End A</dt>
                <dd>{line.assembly.endA.hoseEnd.displayName}</dd>
              </div>
              <div>
                <dt>End B</dt>
                <dd>{line.assembly.endB.hoseEnd.displayName}</dd>
              </div>
              <div>
                <dt>成品长度</dt>
                <dd>
                  {line.assembly.finishedLength.originalValue}{" "}
                  {line.assembly.finishedLength.originalUnit}
                </dd>
              </div>
              <div>
                <dt>测量方式</dt>
                <dd>
                  {line.assembly.measurement.method?.displayName ?? "技术审核"}
                </dd>
              </div>
              <div>
                <dt>接头相对角度</dt>
                <dd>
                  {line.assembly.clocking?.status === "specified"
                    ? `${line.assembly.clocking.targetDisplay}°`
                    : "不适用"}
                </dd>
              </div>
            </>
          )}
          {line.product.specifications.map((spec, index) => (
            <div key={`${spec.label}-${index}`}>
              <dt>{spec.label}</dt>
              <dd>{spec.value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </article>
  );
}

const tabs = [
  { id: "products", label: "商品与金额" },
  { id: "shipments", label: "发货批次" },
  { id: "changes", label: "变更申请" },
  { id: "delivery", label: "客户与交付" },
  { id: "payment", label: "付款与协议" },
  { id: "history", label: "操作记录" },
] as const;
type Tab = (typeof tabs)[number]["id"];
const eventLabels: Record<string, string> = {
  "order.created": "订单已确认",
  "order.hold": "付款复核锁定",
  "order.release": "付款复核已放行",
  "order.follow_on_draft_created": "创建追加采购询价草稿",
  "shipment.plan_mapped": "核对并保存旧订单分批计划",
  "shipment.ready_date_overdue": "预计可发货日期逾期，待内部核对",
  "order.shipping_change_requested": "客户申请发货变更",
  "order.shipping_change_proposed": "已发布发货变更提案",
  "order.shipping_change_effective": "客户接受的发货变更已生效",
};

export default function ConfirmedOrderDetail({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>["data"];
}) {
  const {
    order,
    drafts,
    activity,
    shipmentPlan,
    readySchedules,
    milestones,
    shippingChanges,
    milestoneCommands,
    trackingCommands,
    scheduleCommandIds,
    commandId,
    returnTo,
  } = loaderData;
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    tabs.some((item) => item.id === searchParams.get("tab"))
      ? (searchParams.get("tab") as Tab)
      : "products",
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const snapshot = order.snapshot;
  const buyer = snapshot.buyer;
  const destination = snapshot.destination;
  const requestBase = `/admin/quotes/${encodeURIComponent(order.requestId)}`;
  const charges = [
    ["运费", snapshot.terms.charges.freight],
    ["保险", snapshot.terms.charges.insurance],
    ["关税及进口费用", snapshot.terms.charges.dutiesImport],
    ["销售税", snapshot.terms.charges.salesTax],
    ["切割与标记服务", snapshot.terms.charges.cuttingLabeling],
    ["总成服务", snapshot.terms.charges.assemblyService],
    ["保护层服务", snapshot.terms.charges.protectionService],
  ] as const;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="orders" />
      <main className="admin-main private-review-page orders-workspace order-detail-workspace">
        <Link className="order-back" to={returnTo}>
          <ArrowLeft size={17} /> 返回订单列表
        </Link>
        <header className="order-detail-heading">
          <div>
            <span
              className={`orders-status ${order.status === "Payment Review Hold" ? "hold" : "confirmed"}`}
            >
              {order.status === "Payment Review Hold"
                ? "付款复核锁定"
                : "订单确认"}
            </span>
            <h1 className="confirmed-order-number">{order.orderNumber}</h1>
            <p>
              {buyer.legalName ||
                buyer.tradeName ||
                buyer.contactName ||
                buyer.contactEmail}{" "}
              · {formatPiDate(order.confirmedAt, "admin")}
            </p>
          </div>
          <strong className="order-detail-total">
            {money(order.totalCents)}
          </strong>
        </header>
        {order.status === "Payment Review Hold" && (
          <p className="order-hold-notice" role="status">
            付款正在复核，订单暂时不能放行。请到“付款与到账”查看审核原因。
          </p>
        )}
        <div className="order-detail-actions">
          <a
            className="button button-secondary"
            href={`${requestBase}/pi/${encodeURIComponent(order.piId)}/pdf?disposition=inline`}
            target="_blank"
            rel="noreferrer"
          >
            <FileText size={17} /> 查看 PI
          </a>
          <Link
            className="button button-secondary"
            to={`${requestBase}/pi/payments?piId=${encodeURIComponent(order.piId)}`}
          >
            付款与到账
          </Link>
          <Link className="button button-secondary" to={requestBase}>
            原始 RFQ
          </Link>
          <details className="order-more-menu">
            <summary className="button button-secondary">
              <MoreHorizontal size={18} /> 更多操作
            </summary>
            <div className="order-more-options">
              <button
                type="button"
                aria-label="创建追加采购询价草稿"
                onClick={() => dialog.current?.showModal()}
              >
                <Plus size={16} /> 创建追加采购询价草稿
              </button>
            </div>
          </details>
        </div>
        <nav
          className="orders-status-tabs order-detail-tabs"
          aria-label="订单详情分区"
          role="tablist"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`order-panel-${item.id}`}
              id={`order-tab-${item.id}`}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {tab === "products" && (
          <section
            id="order-panel-products"
            role="tabpanel"
            aria-labelledby="order-tab-products"
            className="order-panel"
          >
            <h2>商品明细</h2>
            <div className="order-line-list">
              {snapshot.lines.map((line) => (
                <OrderLine key={line.id} line={line} />
              ))}
            </div>
            <h2>金额汇总</h2>
            <dl className="order-facts order-amounts">
              <div>
                <dt>商品合计（折扣后）</dt>
                <dd>{money(snapshot.totals.merchandiseCents)}</dd>
              </div>
              <div>
                <dt>商品折扣（已计入）</dt>
                <dd>{money(snapshot.totals.discountCents)}</dd>
              </div>
              {charges.map(([label, cents]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{money(cents)}</dd>
                </div>
              ))}
              <div className="order-amount-total">
                <dt>订单总额</dt>
                <dd>{money(order.totalCents)}</dd>
              </div>
            </dl>
          </section>
        )}
        {tab === "shipments" && (
          <section
            id="order-panel-shipments"
            role="tabpanel"
            aria-labelledby="order-tab-shipments"
            className="order-panel"
          >
            <h2>发货批次</h2>
            <AdminShipmentPlan
              plan={shipmentPlan}
              commandId={commandId}
              busy={busy}
              error={actionData?.error}
            />
            <AdminShipmentReadySchedules
              schedules={readySchedules}
              commandIds={scheduleCommandIds}
              busy={busy}
              error={actionData?.error}
            />
            <AdminShipmentMilestones
              milestones={milestones}
              commands={milestoneCommands}
              trackingCommands={trackingCommands}
              heldShipmentIds={shipmentPlan.shipments
                .filter((item) => item.held)
                .map((item) => item.id)}
              planReady={shipmentPlan.status === "ready"}
              busy={busy}
              error={actionData?.error}
            />
          </section>
        )}
        {tab === "delivery" && (
          <section
            id="order-panel-delivery"
            role="tabpanel"
            aria-labelledby="order-tab-delivery"
            className="order-panel"
          >
            <h2>客户与收货信息</h2>
            <dl className="order-facts">
              <div>
                <dt>采购主体</dt>
                <dd>
                  {buyer.legalName ||
                    buyer.tradeName ||
                    buyer.contactName ||
                    buyer.contactEmail}
                </dd>
              </div>
              <div>
                <dt>采购类型</dt>
                <dd>
                  {buyer.kind === "organization" ? "企业采购" : "个人采购"}
                </dd>
              </div>
              <div>
                <dt>联系人</dt>
                <dd>{buyer.contactName || "未记录"}</dd>
              </div>
              <div>
                <dt>客户邮箱</dt>
                <dd>{buyer.contactEmail}</dd>
              </div>
              <div>
                <dt>收件人</dt>
                <dd>{destination.recipientName}</dd>
              </div>
              <div>
                <dt>收件邮箱</dt>
                <dd>{destination.recipientEmail || "未记录"}</dd>
              </div>
              <div>
                <dt>收件电话</dt>
                <dd>{destination.recipientPhone || "未记录"}</dd>
              </div>
              <div>
                <dt>送货地址</dt>
                <dd>
                  {[
                    destination.addressLine1,
                    destination.addressLine2,
                    destination.city,
                    destination.stateProvince,
                    destination.postalCode,
                    destination.countryCode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </dd>
              </div>
            </dl>
            <h2>交付条款</h2>
            <dl className="order-facts">
              <div>
                <dt>贸易条款</dt>
                <dd>
                  {snapshot.terms.incoterm} · {snapshot.terms.namedPlace}
                </dd>
              </div>
              <div>
                <dt>运输方式</dt>
                <dd>{snapshot.terms.transportMethod}</dd>
              </div>
              <div>
                <dt>发货计划</dt>
                <dd>
                  {snapshot.terms.shipmentMode === "split"
                    ? `分批发货 · ${snapshot.terms.splitPlan}`
                    : "一起发货"}
                </dd>
              </div>
              <div>
                <dt>交期</dt>
                <dd>{snapshot.terms.leadTime}</dd>
              </div>
            </dl>
          </section>
        )}
        {tab === "changes" && (
          <section
            id="order-panel-changes"
            role="tabpanel"
            aria-labelledby="order-tab-changes"
            className="order-panel"
          >
            <h2>订单发货变更</h2>
            <AdminOrderShippingChanges
              changes={shippingChanges}
              shipments={shipmentPlan.shipments.map((shipment) => ({
                id: shipment.id,
                displayName: shipment.displayName,
                status: shipment.status,
                version: shipment.version,
                destination: shipment.destination,
                transportMethod: shipment.transportMethod,
                incoterm: shipment.incoterm,
                namedPlace: shipment.namedPlace,
                carrierName: shipment.carrierName,
                serviceName: shipment.serviceName,
                destinationTaxTreatment: shipment.destinationTaxTreatment,
                allocations: shipment.allocations.map((allocation) => ({
                  lineId: allocation.lineId,
                  displayName: allocation.displayName,
                  physicalQuantity: allocation.physicalQuantity,
                })),
                readyDate:
                  readySchedules.find(
                    (schedule) => schedule.shipmentId === shipment.id,
                  )?.currentEstimateDate ?? null,
              }))}
              milestones={milestones}
              commandId={commandId}
              busy={busy}
              error={actionData?.error}
            />
          </section>
        )}
        {tab === "payment" && (
          <section
            id="order-panel-payment"
            role="tabpanel"
            aria-labelledby="order-tab-payment"
            className="order-panel"
          >
            <h2>付款与协议</h2>
            <dl className="order-facts">
              <div>
                <dt>PI 编号</dt>
                <dd>
                  {snapshot.documentNumber} · 版本 {snapshot.documentVersion}
                </dd>
              </div>
              <div>
                <dt>客户接受 PI</dt>
                <dd>{formatPiDate(activity.acceptedAt, "admin")}</dd>
              </div>
              <div>
                <dt>付款确认</dt>
                <dd>{formatPiDate(activity.paymentConfirmedAt, "admin")}</dd>
              </div>
              <div>
                <dt>已核实金额</dt>
                <dd>{money(activity.paymentConfirmedCents)}</dd>
              </div>
              <div>
                <dt>付款渠道</dt>
                <dd>
                  {activity.paymentChannel === "paypal" ? "PayPal" : "银行转账"}
                </dd>
              </div>
              <div>
                <dt>付款截止日</dt>
                <dd>
                  {activity.paymentDueAt
                    ? formatPiDate(activity.paymentDueAt, "admin")
                    : "未约定截止日"}
                </dd>
              </div>
            </dl>
            <div className="order-panel-links">
              <a
                href={`${requestBase}/pi/${encodeURIComponent(order.piId)}/pdf?disposition=inline`}
                target="_blank"
                rel="noreferrer"
              >
                查看已接受的 PI
              </a>
              <Link
                to={`${requestBase}/pi/payments?piId=${encodeURIComponent(order.piId)}`}
              >
                查看完整付款记录
              </Link>
            </div>
          </section>
        )}
        {tab === "history" && (
          <section
            id="order-panel-history"
            role="tabpanel"
            aria-labelledby="order-tab-history"
            className="order-panel"
          >
            <h2>订单操作记录</h2>
            {activity.events.length ? (
              <ol className="order-timeline">
                {activity.events.map((event, index) => (
                  <li key={`${event.type}-${event.occurredAt}-${index}`}>
                    <strong>{eventLabels[event.type] ?? event.type}</strong>
                    <time>{formatPiDate(event.occurredAt, "admin")}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p>暂无订单操作记录。</p>
            )}
            <h2>关联的追加采购询价</h2>
            {drafts.length ? (
              <ul className="order-related-list">
                {drafts.map((draft) => (
                  <li key={draft.id}>
                    {draft.submittedRequestId ? (
                      <Link
                        to={`/admin/quotes/${encodeURIComponent(draft.submittedRequestId)}`}
                      >
                        已提交 RFQ · {draft.submittedRequestId}
                      </Link>
                    ) : (
                      <span>待客户选择商品 · {draft.id}</span>
                    )}
                    <time>{formatPiDate(draft.createdAt, "admin")}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p>尚无关联草稿。</p>
            )}
          </section>
        )}
        <dialog
          className="order-confirm-dialog"
          ref={dialog}
          aria-labelledby="order-follow-on-title"
        >
          <h2 id="order-follow-on-title">创建追加采购询价草稿？</h2>
          <p>这会为客户新增一个草稿，不会修改原订单，也不会自动提交 RFQ。</p>
          <div className="order-dialog-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => dialog.current?.close()}
              disabled={busy}
            >
              取消
            </button>
            <Form method="post">
              <input type="hidden" name="intent" value="follow-on" />
              <input type="hidden" name="commandId" value={commandId} />
              <button className="button button-primary" disabled={busy}>
                {busy ? "创建中…" : "确认创建"}
              </button>
            </Form>
          </div>
        </dialog>
      </main>
    </div>
  );
}
