import { describe, expect, it } from "vitest";

import {
  catalogFamilyHref,
  catalogPageHref,
  catalogReturnLink,
  catalogPageWindow,
  paginateCatalog,
} from "../app/modules/storefront/domain/catalog-pagination";

const families = Array.from({ length: 116 }, (_, index) => index + 1);
const page = (search: string) =>
  paginateCatalog(families, new URLSearchParams(search));

describe("catalog pagination", () => {
  it("shows 10 families a page by default and 20 on request", () => {
    expect(page("")).toMatchObject({
      items: families.slice(0, 10),
      pagination: { page: 1, pageCount: 12, perPage: 10, total: 116 },
    });
    expect(page("page=2&perPage=20")).toMatchObject({
      items: families.slice(20, 40),
      pagination: { page: 2, pageCount: 6, perPage: 20 },
    });
    expect(page("page=12").items).toEqual(families.slice(110));
  });

  it("falls back to the nearest valid page and the default size", () => {
    expect(page("page=99").pagination.page).toBe(12);
    expect(page("page=0").pagination.page).toBe(1);
    expect(page("page=abc").pagination.page).toBe(1);
    expect(page("perPage=50").pagination.perPage).toBe(10);
    expect(paginateCatalog([], new URLSearchParams("page=3"))).toEqual({
      items: [],
      pagination: { page: 1, pageCount: 1, perPage: 10, total: 0 },
    });
  });

  it("links the first, last and neighbouring pages with gaps between", () => {
    expect(catalogPageWindow({ page: 6, pageCount: 12 })).toEqual([
      1,
      null,
      5,
      6,
      7,
      null,
      12,
    ]);
    expect(catalogPageWindow({ page: 1, pageCount: 12 })).toEqual([
      1,
      2,
      null,
      12,
    ]);
    expect(catalogPageWindow({ page: 2, pageCount: 3 })).toEqual([1, 2, 3]);
    expect(catalogPageWindow({ page: 1, pageCount: 1 })).toEqual([1]);
  });

  it("keeps the search query and leaves defaults out of the URL", () => {
    expect(catalogPageHref("/catalog/hose-ends", "", 1, 10)).toBe(
      "/catalog/hose-ends",
    );
    expect(catalogPageHref("/catalog", "JIC 37", 3, 20)).toBe(
      "/catalog?q=JIC+37&page=3&perPage=20",
    );
  });

  it("returns a product page to the list page it was opened from", () => {
    const list = catalogPageHref("/catalog/hose-ends", "", 5, 20);
    const href = catalogFamilyHref("hose-ends", "jic-37", list);
    expect(href).toBe(
      "/catalog/hose-ends/jic-37?back=%2Fcatalog%2Fhose-ends%3Fpage%3D5%26perPage%3D20",
    );
    const back = new URL(href, "https://shop.test").searchParams.get("back");
    expect(catalogReturnLink(back, "hose-ends")).toEqual({
      href: "/catalog/hose-ends?page=5&perPage=20",
      label: "Back to hose ends",
    });
    expect(catalogReturnLink("/catalog?q=JIC&page=3", "hose-ends")).toEqual({
      href: "/catalog?q=JIC&page=3",
      label: "Back to all products",
    });
    // The first page of its own category needs no parameter.
    expect(catalogFamilyHref("adapters", "a1", "/catalog/adapters")).toBe(
      "/catalog/adapters/a1",
    );
  });

  it("only returns to catalog lists", () => {
    const fallback = { href: "/catalog/hose-ends", label: "Back to hose ends" };
    for (const back of [
      null,
      "https://evil.example/catalog",
      "//evil.example/catalog",
      "/catalog/hose-ends/jic-37",
      "/catalog/unknown",
      "/admin",
    ]) {
      expect(catalogReturnLink(back, "hose-ends")).toEqual(fallback);
    }
    expect(
      catalogReturnLink(
        "/catalog/adapters?page=x&perPage=99&utm=1",
        "hose-ends",
      ),
    ).toEqual({ href: "/catalog/adapters", label: "Back to adapters" });
  });
});
