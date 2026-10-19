import { describe, expect, it } from "vitest";

import {
  sitemapXml,
  storefrontSitemapEntries,
} from "../app/modules/storefront/domain/sitemap";

const families = [
  { category: "hydraulic-hose", familyKey: "sae-100r2at" },
  { category: "hose-ends", familyKey: "b-jic-female-swivel" },
] as const;

describe("storefront sitemap", () => {
  it("lists the home page, catalog, four categories, every family and the static pages", () => {
    expect(
      storefrontSitemapEntries(families).map((entry) => entry.path),
    ).toEqual([
      "/",
      "/catalog",
      "/catalog/hydraulic-hose",
      "/catalog/hose-ends",
      "/catalog/adapters",
      "/catalog/quick-couplers",
      "/catalog/hydraulic-hose/sae-100r2at",
      "/catalog/hose-ends/b-jic-female-swivel",
      "/build-a-hose",
      "/assembly-measurement-guide",
      "/policies/returns",
      "/policies/privacy",
    ]);
  });

  it("dates only the Privacy Notice, from its Last updated line", () => {
    const dated = storefrontSitemapEntries(families).filter(
      (entry) => entry.lastmod,
    );
    expect(dated).toEqual([
      expect.objectContaining({
        path: "/policies/privacy",
        lastmod: "2026-10-19",
      }),
    ]);
  });

  it("writes absolute, escaped URLs with no query strings", () => {
    const xml = sitemapXml("https://customhoseco.com", [
      ...storefrontSitemapEntries(families),
      { path: "/a&b", changefreq: "monthly", priority: "0.5" },
    ]);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain(
      "<url>\n    <loc>https://customhoseco.com/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>",
    );
    expect(xml).toContain("<loc>https://customhoseco.com/a&amp;b</loc>");
    expect(xml.match(/<loc>[^<]*\?/g)).toBeNull();
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
  });
});
