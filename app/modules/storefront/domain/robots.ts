const productionStorefrontOrigin = "https://customhoseco.com";

/**
 * The storefront robots.txt: crawl everything and point at the sitemap. Private pages stay
 * out of the index through noindex, not Disallow, because a crawler must fetch a page to see
 * its noindex. A missing or blank origin falls back to production rather than writing
 * `undefined/sitemap.xml`.
 */
export function robotsTxt(origin: string | undefined) {
  const base = (origin?.trim() || productionStorefrontOrigin).replace(
    /\/+$/,
    "",
  );
  return [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}

/** The admin host serves the same Worker, storefront included; nothing there is for crawlers. */
export const adminRobotsTxt = ["User-agent: *", "Disallow: /", ""].join("\n");

/** Whether a request reached the admin host. Scheme and port are ignored, so `http://` requests count too. */
export function isAdminHost(url: URL, adminOrigin: string) {
  return url.hostname === new URL(adminOrigin).hostname;
}

// Crawlable but kept out of search results on every host.
const privatePaths = new Set([
  "/sign-in",
  "/register",
  "/quote-list",
  "/forgot-password",
]);
// Storefront pages the admin host duplicates; the private pages above are covered already.
const adminHostDuplicatePaths = new Set([
  "/",
  "/catalog",
  "/build-a-hose",
  "/assembly-measurement-guide",
]);
const adminHostDuplicatePrefixes = ["/catalog/", "/policies/"];

/**
 * Whether an HTML page is sent with `X-Robots-Tag: noindex`. Admin pages never are: they
 * answer 401 or a sign-in form, which keeps them out of search results by itself.
 */
export function storefrontNoindex(url: URL, adminOrigin: string) {
  const path = url.pathname.toLowerCase().replace(/(.)\/+$/, "$1");
  if (privatePaths.has(path)) return true;
  return (
    isAdminHost(url, adminOrigin) &&
    (adminHostDuplicatePaths.has(path) ||
      adminHostDuplicatePrefixes.some((prefix) => path.startsWith(prefix)))
  );
}
