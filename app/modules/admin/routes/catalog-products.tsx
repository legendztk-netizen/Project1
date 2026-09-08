import { data } from "react-router";
import type { Route } from "./+types/catalog-products";
import {
  requireAdminRequestContext,
  requireCatalogWriteContext,
} from "../infrastructure/admin-request-context";
import {
  createD1ProductManagementRepository,
  type ProductSelection,
} from "../../catalog/infrastructure/d1-product-management-repository";
import { createD1CatalogItemRepository } from "../../catalog/infrastructure/d1-catalog-item-repository";
import {
  commercialProductTypes,
  type CommercialProductType,
} from "../../catalog/domain/catalog-commercial-maintenance";
import {
  CatalogItemRejected,
  type CatalogItemPayload,
} from "../../catalog/domain/catalog-item-publication";
import {
  productValuesFromForm,
  packagingFields,
} from "../../catalog/domain/catalog-product-fields";
import { ProductManagementPage } from "../ui/product-management-page";
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const types = url.searchParams
    .getAll("type")
    .filter((t): t is CommercialProductType =>
      commercialProductTypes.includes(t as CommercialProductType),
    );
  const pageSize = url.searchParams.get("size") === "50" ? 50 : 20;
  const repository = createD1ProductManagementRepository(env.DB);
  return {
    page: await repository.list({
      types,
      query: url.searchParams.get("q") ?? "",
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize,
    }),
    types,
    query: url.searchParams.get("q") ?? "",
    pageSize,
    state: await createD1CatalogItemRepository(env.DB).state(),
    canEdit: adminIdentity.catalogPermission !== "view",
    canEnable: env.APP_ENV !== "production",
    deletionPlan: url.searchParams.has("deletePlan")
      ? await repository.deletionPlan(
          JSON.parse(url.searchParams.get("deletePlan")!) as ProductSelection[],
        )
      : null,
  };
}
export async function action({ context, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireCatalogWriteContext(context);
  const form = await request.formData();
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const items = createD1CatalogItemRepository(env.DB);
  try {
    if (text("intent") === "enable") {
      await items.enable({
        environment: env.APP_ENV,
        actorId: adminIdentity.id,
      });
      return { ok: true, error: null, result: "已启用条目发布" };
    }
    if (text("intent") === "delete") {
      const result = await createD1ProductManagementRepository(env.DB).remove(
        JSON.parse(text("selected")),
        text("commandId"),
        adminIdentity.id,
        request.headers.get("cf-connecting-ip") ?? "local",
      );
      return {
        ok: true,
        error: null,
        result:
          "results" in result
            ? result.results
                .map(
                  (entry: { code: string; ok: boolean; error?: string }) =>
                    `${entry.code}：${entry.ok ? "已删除" : entry.error}`,
                )
                .join("；")
            : `已删除 ${result.removed.length} 项，历史记录保留`,
      };
    }
    const productType = text("productType") as CommercialProductType;
    if (!commercialProductTypes.includes(productType))
      throw new CatalogItemRejected("Invalid product type / 产品类目无效");
    const kind = text("kind") === "series" ? "series" : "sku";
    const values = productValuesFromForm(form, productType, kind);
    const base = text("basePayload")
      ? (JSON.parse(text("basePayload")) as CatalogItemPayload)
      : null;
    const optionalNumber = (key: string) =>
      text(key) ? Number(text(key)) : null;
    const payload = (kind === "series"
      ? {
          kind,
          productType,
          series: { ...values, representativeImageReference: "" },
          commercialRule: base?.kind === "series" ? base.commercialRule : null,
          mediaVersionId: text("mediaVersionId") || null,
        }
      : {
          kind,
          productType,
          variant: values,
          mediaVersionId: text("mediaVersionId") || null,
          price: {
            amount: optionalNumber("amount"),
            currency: text("currency") || "USD",
            packageLengthFt: optionalNumber("packageLengthFt"),
            ...Object.fromEntries(
              packagingFields.map((f) => [
                f.key,
                f.kind === "number"
                  ? optionalNumber(f.key)
                  : text(f.key) || null,
              ]),
            ),
          },
        }) as unknown as CatalogItemPayload;
    const result = await items.apply({
      commandId: text("commandId"),
      actorId: adminIdentity.id,
      ipAddress: request.headers.get("cf-connecting-ip") ?? "local",
      payload,
      targetState: text("targetState") as "online" | "draft" | "discontinued",
      mode: base ? "edit" : "create",
      baselineRevisionId: text("baselineRevisionId") || null,
      source: { channel: "manual" },
    });
    return { ok: true, error: null, result: `已保存修订 ${result.sequence}` };
  } catch (error) {
    if (error instanceof Error) {
      const findings =
        "findings" in error ? (error.findings as { message: string }[]) : [];
      return data(
        {
          ok: false,
          error: findings.length
            ? findings.map((f) => f.message).join("；")
            : error.message,
          result: null,
        },
        { status: error instanceof CatalogItemRejected ? error.status : 400 },
      );
    }
    throw error;
  }
}
export default function CatalogProducts(props: Route.ComponentProps) {
  return <ProductManagementPage {...props.loaderData} />;
}
