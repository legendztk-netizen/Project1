import type { Route } from "./+types/robots-resource";
import { adminRobotsTxt, isAdminHost, robotsTxt } from "../domain/robots";
import { cloudflareContext } from "#workers/context";

// While the origin has no robots.txt, Cloudflare serves its own comment-only default instead.
export function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const body = isAdminHost(new URL(request.url), env.ADMIN_ORIGIN)
    ? adminRobotsTxt
    : robotsTxt(env.PUBLIC_STOREFRONT_ORIGIN);
  return new Response(body, {
    headers: {
      // Short on purpose: Cloudflare and crawlers both cache robots.txt.
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
