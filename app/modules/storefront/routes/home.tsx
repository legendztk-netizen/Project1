import { redirect } from "react-router";

import type { Route } from "./+types/home";
import { HomePage } from "../ui/home-page";
import { cloudflareContext } from "#workers/context";

const siteOrigin = "https://customhoseco.com";
const description =
  "Made-to-order hydraulic hose assemblies. Choose the hose, pick both ends, set the length and request a quote. Made to your exact specification.";

export function loader({ context, request }: Route.LoaderArgs) {
  // Product search moved to /catalog; keep old `/?q=` links working.
  const url = new URL(request.url);
  if (url.searchParams.has("q")) {
    throw redirect(`/catalog${url.search}`);
  }
  const { env } = context.get(cloudflareContext);
  return { appName: env.PUBLIC_APP_NAME };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const title = `${loaderData?.appName ?? "Hydraulic Supply"} | Custom Hydraulic Hose Assemblies`;
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
