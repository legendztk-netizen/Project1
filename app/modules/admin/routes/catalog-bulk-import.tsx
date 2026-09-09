import "../ui/catalog-request-review.css";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/catalog-bulk-import";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  requireAdminRequestContext,
  requireCatalogWriteContext,
} from "../infrastructure/admin-request-context";
import { action as requestAction } from "./catalog-requests";
export function meta() {
  return [{ title: "批量导入产品 | Admin Backoffice" }];
}
export async function loader({ context }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  return {
    mode: (
      await env.DB.prepare(
        "SELECT mode FROM catalog_item_publication_state WHERE singleton=1",
      ).first<{ mode: string }>()
    )?.mode,
    canEdit: adminIdentity.catalogPermission !== "view",
    batchId: crypto.randomUUID(),
  };
}
export async function action(args: Route.ActionArgs) {
  requireCatalogWriteContext(args.context);
  const form = await args.request.clone().formData();
  if (form.get("intent") !== "import")
    throw new Response("此页面仅接受工作簿导入", { status: 400 });
  return requestAction(args);
}
export default function BulkImport() {
  const page = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="imports" maintenanceMode="excel" />
      <main className="catalog-request-page">
        <h1>批量导入产品</h1>
        <p>
          上传 Excel
          后生成独立待审核请求。导入成功后查看本批次结果，再进入审核发布。
        </p>
        <p>参数、价格和图片一起审核；系列销售规则在“销售、包装和价格”维护。</p>
        <p>
          <a href="/admin/catalog/item-template" download>
            下载条目导入模板
          </a>{" "}
          · <Link to="/admin/catalog/requests">查看产品更新请求</Link>
        </p>
        {result && <p role="alert">{result.error}</p>}
        <Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="import" />
          <input type="hidden" name="batchId" value={page.batchId} />
          <label>
            Excel 工作簿
            <input type="file" name="workbook" accept=".xlsx" required />
          </label>
          <button disabled={!page.canEdit || page.mode !== "items"}>
            导入为独立请求
          </button>
        </Form>
        {page.mode !== "items" && <p>条目发布尚未启用，请先完成目录切换。</p>}
      </main>
    </div>
  );
}
