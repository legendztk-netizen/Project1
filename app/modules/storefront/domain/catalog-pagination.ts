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

/** One page of catalog families from `?page=` and `?perPage=`; out-of-range pages land on the nearest page. */
export function paginateCatalog<T>(
  items: readonly T[],
  searchParams: URLSearchParams,
): { items: T[]; pagination: CatalogPagination } {
  const requestedSize = positiveInteger(searchParams.get("perPage"));
  const perPage =
    catalogPageSizes.find((size) => size === requestedSize) ??
    defaultCatalogPageSize;
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const page = Math.min(
    Math.max(positiveInteger(searchParams.get("page")) ?? 1, 1),
    pageCount,
  );
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
