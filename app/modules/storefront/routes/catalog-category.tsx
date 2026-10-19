import { storefrontCatalogCache } from "../../catalog/infrastructure/public-catalog-edge-cache";
import type { Route } from "./+types/catalog-category";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { requireCatalogFamilyId } from "../domain/catalog-route";
import { paginateCatalog } from "../domain/catalog-pagination";
import { catalogCategorySeo, seoMeta } from "../domain/catalog-seo";
import { CatalogBrowser } from "../ui/catalog-browser";
import { cloudflareContext } from "#workers/context";

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const activeCategory = requireCatalogFamilyId(params.category);
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const catalog = createD1PublicCatalogRepository(env.DB, {
    sharedCache: true,
    edgeCache: storefrontCatalogCache(context.get(cloudflareContext)),
  });
  // Title and description describe the whole category, so they read every family, not this page.
  const [result, category] = await Promise.all([
    catalog.browseSummaries({ category: activeCategory, query }),
    catalog.browse({ category: activeCategory }),
  ]);
  // Summaries stay cached whole; only the requested page is sent to the browser.
  const { items, pagination } = paginateCatalog(result, searchParams);
  return {
    activeCategory,
    appName: env.PUBLIC_APP_NAME,
    families: items,
    pagination,
    query,
    seo: catalogCategorySeo(
      activeCategory,
      category.families,
      env.PUBLIC_APP_NAME,
      env.PUBLIC_STOREFRONT_ORIGIN,
    ),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return loaderData ? seoMeta(loaderData.seo) : [];
}

export default function CatalogCategory({ loaderData }: Route.ComponentProps) {
  return <CatalogBrowser data={loaderData} />;
}
