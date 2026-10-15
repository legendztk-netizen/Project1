import { storefrontCatalogCache } from "../../catalog/infrastructure/public-catalog-edge-cache";
import type { Route } from "./+types/catalog-home";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { paginateCatalog } from "../domain/catalog-pagination";
import { CatalogBrowser } from "../ui/catalog-browser";
import { cloudflareContext } from "#workers/context";

export function meta() {
  return [
    { title: "Hydraulic Supply | Hose and Fittings" },
    {
      name: "description",
      content:
        "Hydraulic hose, fittings and custom assembly quote preparation.",
    },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const result = await createD1PublicCatalogRepository(env.DB, {
    sharedCache: true,
    edgeCache: storefrontCatalogCache(context.get(cloudflareContext)),
  }).browseSummaries({
    query,
  });
  // Summaries stay cached whole; only the requested page is sent to the browser.
  const { items, pagination } = paginateCatalog(result, searchParams);
  return {
    activeCategory: null,
    appName: env.PUBLIC_APP_NAME,
    families: items,
    pagination,
    query,
  };
}

export default function CatalogHome({ loaderData }: Route.ComponentProps) {
  return <CatalogBrowser data={loaderData} />;
}
