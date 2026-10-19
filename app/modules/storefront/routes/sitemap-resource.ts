import { storefrontCatalogCache } from "../../catalog/infrastructure/public-catalog-edge-cache";
import type { Route } from "./+types/sitemap-resource";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { sitemapXml, storefrontSitemapEntries } from "../domain/sitemap";
import { cloudflareContext } from "#workers/context";

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  // The same cached summaries as an unfiltered /catalog, so this costs no extra catalog read.
  const families = await createD1PublicCatalogRepository(env.DB, {
    sharedCache: true,
    edgeCache: storefrontCatalogCache(context.get(cloudflareContext)),
  }).browseSummaries({});
  return new Response(
    sitemapXml(
      env.PUBLIC_STOREFRONT_ORIGIN,
      storefrontSitemapEntries(families),
    ),
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "application/xml; charset=utf-8",
      },
    },
  );
}
