import { storefrontCatalogCache } from "../../catalog/infrastructure/public-catalog-edge-cache";
import type { Route } from "./+types/catalog-category";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { requireCatalogFamilyId } from "../domain/catalog-route";
import { CatalogBrowser } from "../ui/catalog-browser";
import { cloudflareContext } from "#workers/context";

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const activeCategory = requireCatalogFamilyId(params.category);
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const result = await createD1PublicCatalogRepository(env.DB, {
    sharedCache: true,
    edgeCache: storefrontCatalogCache(context.get(cloudflareContext)),
  }).browseSummaries({
    category: activeCategory,
    query,
  });
  return {
    activeCategory,
    appName: env.PUBLIC_APP_NAME,
    families: result,
    query,
    releaseNumber: result[0]?.representative.releaseNumber ?? null,
  };
}

export default function CatalogCategory({ loaderData }: Route.ComponentProps) {
  return <CatalogBrowser data={loaderData} />;
}
