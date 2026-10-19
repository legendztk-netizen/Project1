import { choiceParam, isoDateParam } from "../../shared/domain/search-params";

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

/** The unfiltered first page, newest registrations first. */
export const customerDirectoryDefaults: CustomerDirectoryFilters = {
  query: "",
  from: "",
  to: "",
  type: "all",
  country: "",
  orders: "all",
  sort: "registered_desc",
  page: 1,
};

/** Whether anything narrows the list; sort and page do not. */
export function customerDirectoryIsFiltered(filters: CustomerDirectoryFilters) {
  return (["query", "from", "to", "type", "country", "orders"] as const).some(
    (key) => filters[key] !== customerDirectoryDefaults[key],
  );
}

export function customerDirectoryFilters(
  params: URLSearchParams,
): CustomerDirectoryFilters {
  const country = (params.get("country") ?? "").trim().toUpperCase();
  return {
    query: (params.get("q") ?? "").trim().slice(0, 150),
    from: isoDateParam(params.get("from")),
    to: isoDateParam(params.get("to")),
    type: choiceParam(params.get("type"), customerDirectoryTypes),
    country: /^[A-Z0-9]{2}$/.test(country) ? country : "",
    orders: choiceParam(params.get("orders"), customerDirectoryOrderFilters),
    sort: choiceParam(params.get("sort"), customerDirectorySorts),
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
  const names = {
    query: "q",
    from: "from",
    to: "to",
    type: "type",
    country: "country",
    orders: "orders",
    sort: "sort",
    page: "page",
  } as const;
  for (const key of Object.keys(names) as (keyof typeof names)[])
    if (next[key] !== customerDirectoryDefaults[key])
      params.set(names[key], String(next[key]));
  const search = params.toString();
  return search ? `?${search}` : "";
}
