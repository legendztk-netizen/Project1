import {
  data,
  Link,
  redirect,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { ArrowLeft } from "lucide-react";

import { piPrivateHeaders, piRouteId } from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  createShipmentDocumentsService,
  type ShipmentDocumentKind,
} from "../../shipment/application/shipment-documents-service";
import type { ShipmentPackingDraft } from "../../shipment/domain/shipment-packing";
import { AdminShipmentDocumentsWorkspace } from "../../shipment/ui/admin-shipment-documents-workspace";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import "../../shipment/ui/shipment-documents.css";

export const headers = piPrivateHeaders;

async function adminError(error: unknown) {
  const message =
    error instanceof Response
      ? await error.text()
      : error instanceof Error
        ? error.message
        : "";
  if (error instanceof Response && error.status === 413)
    return "文件超过 10 MB 限制。";
  if (/Only PDF, PNG and JPEG/.test(message))
    return "仅支持 PDF、PNG 或 JPEG 文件。";
  if (/File must be between/.test(message))
    return "文件必须大于 0 字节且不超过 10 MB。";
  if (/Upload recovery required|Upload reservation expired/.test(message))
    return "上一次上传已中断，请重新选择文件并提交。";
  if (/Packing record changed|Shipment document changed/.test(message))
    return "资料已被其他管理员更新，请刷新页面后重试。";
  if (/Command identity conflict/.test(message))
    return "此操作标识已用于另一项修改，请刷新页面后重试。";
  if (
    /positive measured value|positive whole number|supported measurement/.test(
      message,
    )
  )
    return "箱数、尺寸、重量或除数必须是有效的正数。";
  if (/all three carton dimensions/.test(message))
    return "请填写纸箱长、宽、高三项，或全部留空。";
  if (/No more than 100 carton groups/.test(message))
    return "纸箱组最多只能添加 100 组。";
  if (/Packing notes/.test(message)) return "内部装箱备注最多 2000 字。";
  if (/Explicit.*units/.test(message)) return "请选择有效的尺寸与重量单位。";
  if (error instanceof Response && error.status === 409)
    return "资料已被更新，请刷新页面后重试。";
  return "操作未完成，请检查填写内容后重试。";
}

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const orderId = piRouteId(params.orderId);
  const shipmentId = piRouteId(params.shipmentId);
  const search = new URL(request.url).searchParams;
  const workspace = await createShipmentDocumentsService(
    env.DB,
    env.PRIVATE_FILES,
  ).adminList(
    adminIdentity,
    orderId,
    shipmentId,
    Number(search.get("page") ?? 1),
  );
  return data(
    {
      orderId,
      shipmentId,
      workspace,
      commandId: crypto.randomUUID(),
      selectedTab:
        search.get("tab") === "files"
          ? ("files" as const)
          : ("packing" as const),
      saved: search.has("saved"),
    },
    { headers: headers() },
  );
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const orderId = piRouteId(params.orderId);
  const shipmentId = piRouteId(params.shipmentId);
  const service = createShipmentDocumentsService(env.DB, env.PRIVATE_FILES);
  const auditRequestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const auditIp = request.headers.get("cf-connecting-ip");
  let intent = "";
  let inDialog = false;
  try {
    const form = await readPrivateReviewForm(request);
    const text = (key: string) => String(form.get(key) ?? "");
    intent = text("intent");
    inDialog = text("responseMode") === "dialog";
    if (intent === "packing") {
      const draft = JSON.parse(text("packingJson")) as ShipmentPackingDraft;
      await service.savePacking(adminIdentity, {
        orderId,
        shipmentId,
        draft,
        expectedVersion: Number(text("expectedVersion")),
        commandId: text("commandId"),
        auditRequestId,
        auditIp,
      });
    } else if (intent === "upload") {
      const file = form.get("file");
      if (!(file instanceof File))
        throw new Response("请选择文件", { status: 400 });
      await service.upload(adminIdentity, {
        orderId,
        shipmentId,
        commandId: text("commandId"),
        kind: text("kind") as ShipmentDocumentKind,
        file,
        auditRequestId,
        auditIp,
      });
    } else if (intent === "visibility") {
      await service.changeVisibility(adminIdentity, {
        orderId,
        shipmentId,
        documentId: text("documentId"),
        expectedVersion: Number(text("expectedVersion")),
        commandId: text("commandId"),
        visibility: text("visibility") as "internal" | "customer_shared",
        auditRequestId,
        auditIp,
      });
    } else {
      throw new Response("Invalid operation", { status: 400 });
    }
  } catch (error) {
    if (error instanceof Response && ![400, 409, 413].includes(error.status))
      throw error;
    const retryCommandId =
      error instanceof Response &&
      /Upload recovery required|Upload reservation expired/.test(
        await error.clone().text(),
      )
        ? crypto.randomUUID()
        : undefined;
    return data(
      {
        error: await adminError(error),
        retryCommandId,
      },
      { status: error instanceof Response ? error.status : 400 },
    );
  }
  const tab = intent === "packing" ? "packing" : "files";
  // The order page opens this workspace in a dialog through a fetcher; it
  // reloads the workspace itself instead of following a redirect.
  if (inDialog) return data({ saved: true as const, tab });
  return redirect(
    `/admin/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(shipmentId)}?tab=${tab}&saved=1`,
  );
}

type LoaderData = Awaited<ReturnType<typeof loader>>["data"];

export default function ShipmentDocuments({
  loaderData,
  actionData,
}: {
  loaderData: LoaderData;
  actionData?: { error?: string; retryCommandId?: string };
}) {
  const { orderId, workspace } = loaderData;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="orders" />
      <main className="admin-main shipment-documents-page">
        <Link
          to={`/admin/orders/${encodeURIComponent(orderId)}`}
          className="admin-back-link"
        >
          <ArrowLeft size={18} aria-hidden="true" /> 返回订单详情
        </Link>
        <p className="shipment-documents-eyebrow">
          第 {workspace.shipment.sequenceNumber} 批发货
        </p>
        <h1>{workspace.shipment.displayName}</h1>
        <AdminShipmentDocumentsWorkspace
          loaderData={loaderData}
          actionData={actionData}
          busy={busy}
        />
      </main>
    </div>
  );
}
