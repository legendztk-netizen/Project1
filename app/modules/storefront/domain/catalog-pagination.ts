import {
  launchCatalogFamilies,
  type CatalogFamilyId,
} from "../../catalog/domain/catalog-family";

export const catalogPageSizes = [10, 20] as const;
export type CatalogPageSize = (typeof catalogPageSizes)[number];
export const defaultCatalogPageSize: CatalogPageSize = 10;

export interface CatalogPagination {
  page: number;
  pageCount: number;
  perPage: CatalogPageSize;
  total: number;
}

function positiveInteger(value: string | null) {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

/** The requested page (at least 1) and a supported page size. */
function catalogListRequest(searchParams: URLSearchParams) {
  const requestedSize = positiveInteger(searchParams.get("perPage"));
  return {
    page: Math.max(positiveInteger(searchParams.get("page")) ?? 1, 1),
    perPage:
      catalogPageSizes.find((size) => size === requestedSize) ??
      defaultCatalogPageSize,
  };
}

/** One page of catalog families from `?page=` and `?perPage=`; out-of-range pages land on the nearest page. */
export function paginateCatalog<T>(
  items: readonly T[],
  searchParams: URLSearchParams,
): { items: T[]; pagination: CatalogPagination } {
  const request = catalogListRequest(searchParams);
  const { perPage } = request;
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const page = Math.min(request.page, pageCount);
  return {
    items: items.slice((page - 1) * perPage, page * perPage),
    pagination: { page, pageCount, perPage, total: items.length },
  };
}

/** The current page with its neighbours plus the first and last page; `null` marks a gap. */
export function catalogPageWindow({
  page,
  pageCount,
}: Pick<CatalogPagination, "page" | "pageCount">) {
  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])].filter(
    (value) => value >= 1 && value <= pageCount,
  );
  return pages
    .toSorted((left, right) => left - right)
    .flatMap((value, index, sorted) =>
      index > 0 && value - sorted[index - 1]! > 1 ? [null, value] : [value],
    );
}

/** A catalog list URL that keeps the search query; defaults are left out. */
export function catalogPageHref(
  path: string,
  query: string,
  page: number,
  perPage: CatalogPageSize,
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  if (perPage !== defaultCatalogPageSize)
    params.set("perPage", String(perPage));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/** A product family link that remembers the list it was opened from, unless that is its own category's first page. */
export function catalogFamilyHref(
  category: CatalogFamilyId,
  familyKey: string,
  listHref: string,
) {
  const path = `/catalog/${category}/${familyKey}`;
  return listHref === `/catalog/${category}`
    ? path
    : `${path}?back=${encodeURIComponent(listHref)}`;
}

/** Where a product page's Back link goes: the catalog list from `?back=` (lists only), else page 1 of its category. */
export function catalogReturnLink(
  back: string | null,
  category: CatalogFamilyId,
) {
  const fallback = {
    href: `/catalog/${category}`,
    label: `Back to ${category.replaceAll("-", " ")}`,
  };
  if (!back) return fallback;
  const base = "https://catalog.invalid";
  let url: URL;
  try {
    url = new URL(back, base);
  } catch {
    return fallback;
  }
  const match = /^\/catalog(?:\/([a-z-]+))?$/.exec(url.pathname);
  if (url.origin !== base || !match) return fallback;
  const listCategory = match[1]
    ? launchCatalogFamilies.find((family) => family.id === match[1])?.id
    : null;
  if (listCategory === undefined) return fallback;
  const { page, perPage } = catalogListRequest(url.searchParams);
  return {
    href: catalogPageHref(
      listCategory ? `/catalog/${listCategory}` : "/catalog",
      url.searchParams.get("q")?.trim() ?? "",
      page,
      perPage,
    ),
    label: `Back to ${listCategory ? listCategory.replaceAll("-", " ") : "all products"}`,
  };
}
