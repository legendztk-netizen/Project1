import { expect, it } from "vitest";

import {
  customerDirectoryDefaults,
  customerDirectoryFilters,
  customerDirectoryIsFiltered,
  customerDirectorySearch,
} from "../app/modules/customer-identity/domain/customer-directory";

it("reads list filters from the URL and falls back to defaults for unknown values", () => {
  const filters = customerDirectoryFilters(
    new URLSearchParams(
      "q=%20Acme%20&from=2026-09-01&to=bad&type=organization&country=ca&orders=nope&sort=registered_asc&page=2",
    ),
  );
  expect(filters).toEqual({
    query: "Acme",
    from: "2026-09-01",
    to: "",
    type: "organization",
    country: "CA",
    orders: "all",
    sort: "registered_asc",
    page: 2,
  });
  expect(customerDirectoryFilters(new URLSearchParams())).toMatchObject({
    type: "all",
    orders: "all",
    sort: "registered_desc",
    page: 1,
  });
});

it("writes only non-default filters into the query string", () => {
  const filters = customerDirectoryFilters(
    new URLSearchParams("type=individual"),
  );
  expect(customerDirectorySearch(filters)).toBe("?type=individual");
  expect(
    customerDirectorySearch(filters, { sort: "registered_asc", page: 3 }),
  ).toBe("?type=individual&sort=registered_asc&page=3");
  expect(customerDirectorySearch(filters, { type: "all" })).toBe("");
});

it("counts only narrowing filters as filtered, not sort or page", () => {
  expect(customerDirectoryIsFiltered(customerDirectoryDefaults)).toBe(false);
  expect(
    customerDirectoryIsFiltered({
      ...customerDirectoryDefaults,
      sort: "registered_asc",
      page: 3,
    }),
  ).toBe(false);
  expect(
    customerDirectoryIsFiltered({
      ...customerDirectoryDefaults,
      to: "2026-10-01",
    }),
  ).toBe(true);
});
