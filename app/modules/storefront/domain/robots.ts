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
