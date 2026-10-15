import { storefrontCatalogCache } from "../../catalog/infrastructure/public-catalog-edge-cache";
import type { Route } from "./+types/catalog-category";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { requireCatalogFamilyId } from "../domain/catalog-route";
import { paginateCatalog } from "../domain/catalog-pagination";
import { CatalogBrowser } from "../ui/catalog-browser";
import { cloudflareContext } from "#workers/context";

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const activeCategory = requireCatalogFamilyId(params.category);
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const result = await createD1PublicCatalogRepository(env.DB, {
    sharedCache: true,
    edgeCache: storefrontCatalogCache(context.get(cloudflareContext)),
  }).browseSummaries({
    category: activeCategory,
    query,
  });
  // Summaries stay cached whole; only the requested page is sent to the browser.
  const { items, pagination } = paginateCatalog(result, searchParams);
  return {
    activeCategory,
    appName: env.PUBLIC_APP_NAME,
    families: items,
    pagination,
    query,
  };
}

export default function CatalogCategory({ loaderData }: Route.ComponentProps) {
  return <CatalogBrowser data={loaderData} />;
}
