export const customerDirectorySorts = [
  "registered_desc",
  "registered_asc",
] as const;
export const customerDirectoryTypes = [
  "all",
  "individual",
  "organization",
] as const;
export const customerDirectoryOrderFilters = [
  "all",
  "with",
  "without",
] as const;

/** Admin Customer Directory list filters; dates are Beijing calendar dates. */
export interface CustomerDirectoryFilters {
  query: string;
  from: string;
  to: string;
  type: (typeof customerDirectoryTypes)[number];
  country: string;
  orders: (typeof customerDirectoryOrderFilters)[number];
  sort: (typeof customerDirectorySorts)[number];
  page: number;
}

function choice<T extends string>(
  value: string | null,
  options: readonly T[],
): T {
  return options.find((option) => option === value) ?? options[0];
}

export function customerDirectoryFilters(
  params: URLSearchParams,
): CustomerDirectoryFilters {
  const date = (value: string | null) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  const country = (params.get("country") ?? "").trim().toUpperCase();
  return {
    query: (params.get("q") ?? "").trim().slice(0, 150),
    from: date(params.get("from")),
    to: date(params.get("to")),
    type: choice(params.get("type"), customerDirectoryTypes),
    country: /^[A-Z0-9]{2}$/.test(country) ? country : "",
    orders: choice(params.get("orders"), customerDirectoryOrderFilters),
    sort: choice(params.get("sort"), customerDirectorySorts),
    page: Math.max(1, Math.floor(Number(params.get("page"))) || 1),
  };
}

/** The query string for a filter set, leaving defaults out. */
export function customerDirectorySearch(
  filters: CustomerDirectoryFilters,
  changes: Partial<CustomerDirectoryFilters> = {},
) {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  if (next.from) params.set("from", next.from);
  if (next.to) params.set("to", next.to);
  if (next.type !== "all") params.set("type", next.type);
  if (next.country) params.set("country", next.country);
  if (next.orders !== "all") params.set("orders", next.orders);
  if (next.sort !== "registered_desc") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  const search = params.toString();
  return search ? `?${search}` : "";
}
