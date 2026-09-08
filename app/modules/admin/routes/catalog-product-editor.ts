import type { Route } from "./+types/catalog-product-editor";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createD1CatalogItemRepository } from "../../catalog/infrastructure/d1-catalog-item-repository";
import { createD1ProductManagementRepository } from "../../catalog/infrastructure/d1-product-management-repository";
import {
  commercialProductTypes,
  type CommercialProductType,
} from "../../catalog/domain/catalog-commercial-maintenance";
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") as CommercialProductType;
  if (!commercialProductTypes.includes(type))
    throw new Response("产品类目无效", { status: 400 });
  const kind = url.searchParams.get("kind") === "series" ? "series" : "sku";
  const code = url.searchParams.get("code") ?? "";
  const repository = createD1CatalogItemRepository(env.DB);
  const payload = code
    ? await repository.findProductPayload(type, kind, code, true)
    : null;
  if (code && !payload) throw new Response("产品不存在", { status: 404 });
  const revision = code
    ? await env.DB.prepare(
        "SELECT r.target_state FROM catalog_product_entities e JOIN catalog_product_revisions r ON r.id=COALESCE(e.draft_revision_id,e.current_revision_id) WHERE e.kind=? AND e.product_type=? AND e.code=?",
      )
        .bind(kind, type, code)
        .first<{ target_state: string }>()
    : null;
  return {
    targetState: revision?.target_state ?? "online",
    payload,
    productType: type,
    kind: kind as "series" | "sku",
    commandId: crypto.randomUUID(),
    canEdit: adminIdentity.catalogPermission !== "view",
    baselineRevisionId: code
      ? ((await repository.history(kind, code, type))[0]?.revisionId ?? null)
      : null,
    series: (await createD1ProductManagementRepository(env.DB).all()).filter(
      (r) => r.kind === "series" && r.productType === type,
    ),
    media: (
      await env.DB.prepare(
        "SELECT id,COALESCE(approved_reference,id) AS label FROM catalog_media_versions ORDER BY created_at DESC",
      ).all<{ id: string; label: string }>()
    ).results,
  };
}
