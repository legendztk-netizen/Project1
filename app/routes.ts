import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("modules/storefront/routes/catalog-home.tsx"),
  route("catalog/:category", "modules/storefront/routes/catalog-category.tsx"),
  route(
    "catalog/:category/:familyKey",
    "modules/storefront/routes/catalog-product-family.tsx",
  ),
  route(
    "api/catalog/products/:sku",
    "modules/storefront/routes/catalog-product-resource.ts",
  ),
  route(
    "api/catalog/releases/:releaseId/products/:sku",
    "modules/storefront/routes/catalog-release-product-resource.ts",
  ),
  route("build-a-hose", "modules/storefront/routes/build-a-hose.tsx"),
  route("quote-list", "modules/storefront/routes/anonymous-quote-list.tsx"),
  route(
    "assembly-measurement-guide",
    "modules/storefront/routes/assembly-measurement-guide.tsx",
  ),
  route("admin", "modules/admin/routes/admin-home.tsx"),
  route("admin/catalog/import", "modules/admin/routes/catalog-import.tsx"),
  route("admin/catalog/review", "modules/admin/routes/catalog-review.tsx"),
  route("admin/catalog/releases", "modules/admin/routes/catalog-releases.tsx"),
  route(
    "admin/catalog/reference-data",
    "modules/admin/routes/catalog-reference-data.tsx",
  ),
  route(
    "admin/diagnostics/catalog-release",
    "modules/admin/routes/catalog-release-diagnostic.tsx",
  ),
] satisfies RouteConfig;
