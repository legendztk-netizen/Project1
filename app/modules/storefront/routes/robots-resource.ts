import type { Route } from "./+types/robots-resource";
import { robotsTxt } from "../domain/robots";
import { cloudflareContext } from "#workers/context";

// While the origin has no robots.txt, Cloudflare serves its own comment-only default instead.
export function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return new Response(robotsTxt(env.PUBLIC_STOREFRONT_ORIGIN), {
    headers: {
      // Short on purpose: Cloudflare and crawlers both cache robots.txt.
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
