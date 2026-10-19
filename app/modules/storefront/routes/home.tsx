import { redirect } from "react-router";

import type { Route } from "./+types/home";
import { storefrontCatalogCache } from "../../catalog/infrastructure/public-catalog-edge-cache";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { homeDescription, homeTitle } from "../domain/page-seo";
import { HomePage } from "../ui/home-page";
import { cloudflareContext } from "#workers/context";

const siteOrigin = "https://customhoseco.com";

export async function loader({ context, request }: Route.LoaderArgs) {
  // Product search moved to /catalog; keep old `/?q=` links working.
  const url = new URL(request.url);
  if (url.searchParams.has("q")) {
    throw redirect(`/catalog${url.search}`);
  }
  const { env } = context.get(cloudflareContext);
  let hoseCatalog: { seriesCount: number; sizeCount: number } | null = null;
  try {
    // The cached hose summaries an unfiltered /catalog/hydraulic-hose reads.
    const hoses = await createD1PublicCatalogRepository(env.DB, {
      sharedCache: true,
      edgeCache: storefrontCatalogCache(context.get(cloudflareContext)),
    }).browseSummaries({ category: "hydraulic-hose" });
    hoseCatalog = {
      seriesCount: hoses.length,
      sizeCount: hoses.reduce(
        (total, family) => total + family.variantCount,
        0,
      ),
    };
  } catch (error) {
    // The landing page never fails over its description; it drops the counts instead.
    console.error("Home page hose counts unavailable", error);
  }
  return {
    appName: env.PUBLIC_APP_NAME,
    description: homeDescription(hoseCatalog),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const title = homeTitle(loaderData?.appName ?? "Hydraulic Supply");
  const description = loaderData?.description ?? homeDescription(null);
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${siteOrigin}/` },
    {
      property: "og:image",
      content: `${siteOrigin}/images/home/hose-en4sp.jpg`,
    },
    { tagName: "link", rel: "canonical", href: `${siteOrigin}/` },
  ];
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return <HomePage appName={loaderData.appName} />;
}
