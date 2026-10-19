import {
  launchCatalogFamilies,
  type CatalogFamilyId,
} from "../../catalog/domain/catalog-family";
import { RETURN_POLICY_PATH } from "../../after-sales/domain/return-policy";
import { privacyNoticePath, privacyNoticeUpdated } from "./privacy-notice";

type ChangeFrequency = "weekly" | "monthly";

export interface SitemapEntry {
  changefreq: ChangeFrequency;
  /** `YYYY-MM-DD`, only when the page carries a real update date. */
  lastmod?: string;
  path: string;
  priority: string;
}

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `Oct 19, 2026` → `2026-10-19`; anything else gives no date rather than a guessed one. */
function displayDate(value: string) {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(value);
  const month = match ? months.indexOf(match[1]!) + 1 : 0;
  if (!match || !month) return undefined;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
}

/**
 * Every public storefront page worth indexing, as bare paths: no query strings, so
 * `?back=`, `?page=` and search URLs never appear. Families come from the published
 * catalog, so new families are listed as soon as they go online.
 */
export function storefrontSitemapEntries(
  families: ReadonlyArray<{ category: CatalogFamilyId; familyKey: string }>,
): SitemapEntry[] {
  const privacyUpdated = displayDate(privacyNoticeUpdated);
  return [
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/catalog", changefreq: "weekly", priority: "0.9" },
    // The same categories as the catalog sidebar: ferrules left the storefront with ADR 0056.
    ...launchCatalogFamilies
      .filter((category) => category.id !== "ferrules")
      .map((category) => ({
        path: `/catalog/${category.id}`,
        changefreq: "weekly" as const,
        priority: "0.9",
      })),
    ...families.map((family) => ({
      path: `/catalog/${family.category}/${family.familyKey}`,
      changefreq: "weekly" as const,
      priority: "0.8",
    })),
    { path: "/build-a-hose", changefreq: "weekly", priority: "0.8" },
    {
      path: "/assembly-measurement-guide",
      changefreq: "monthly",
      priority: "0.6",
    },
    { path: RETURN_POLICY_PATH, changefreq: "monthly", priority: "0.5" },
    {
      path: privacyNoticePath,
      changefreq: "monthly",
      priority: "0.5",
      ...(privacyUpdated ? { lastmod: privacyUpdated } : {}),
    },
  ];
}

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

/** A sitemaps.org `<urlset>` with absolute URLs on the storefront origin. */
export function sitemapXml(origin: string, entries: readonly SitemapEntry[]) {
  const urls = entries.map((entry) =>
    [
      "  <url>",
      `    <loc>${escapeXml(new URL(entry.path, origin).href)}</loc>`,
      ...(entry.lastmod ? [`    <lastmod>${entry.lastmod}</lastmod>`] : []),
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      "  </url>",
    ].join("\n"),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
