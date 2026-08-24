import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("modules/storefront/routes/catalog-home.tsx"),
  route("admin", "modules/admin/routes/admin-home.tsx"),
  route("admin/catalog/import", "modules/admin/routes/catalog-import.tsx"),
  route("admin/catalog/review", "modules/admin/routes/catalog-review.tsx"),
  route(
    "admin/diagnostics/catalog-release",
    "modules/admin/routes/catalog-release-diagnostic.tsx",
  ),
] satisfies RouteConfig;
