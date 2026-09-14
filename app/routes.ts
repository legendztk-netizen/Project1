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
  route(
    "media/catalog/:mediaVersionId/:variant",
    "modules/storefront/routes/catalog-main-image-resource.ts",
  ),
  route("build-a-hose", "modules/storefront/routes/build-a-hose.tsx"),
  route(
    "api/configurator/compatible-end-a",
    "modules/storefront/routes/configurator-compatible-end-a-resource.ts",
  ),
  route(
    "api/configurator/quote-assembly",
    "modules/storefront/routes/configurator-add-assembly-resource.ts",
  ),
  route(
    "api/configurator/saved-configurations",
    "modules/storefront/routes/configurator-saved-configuration-resource.ts",
  ),
  route("quote-list", "modules/storefront/routes/anonymous-quote-list.tsx"),
  route(
    "quote-request/:requestId/confirmation",
    "modules/storefront/routes/quote-request-confirmation.tsx",
  ),
  route("register", "modules/customer-identity/routes/register.tsx"),
  route("sign-in", "modules/customer-identity/routes/sign-in.tsx"),
  route("sign-out", "modules/customer-identity/routes/sign-out.ts"),
  route("account", "modules/customer-identity/routes/customer-account.tsx"),
  route(
    "account/quotes/:requestId",
    "modules/customer-identity/routes/customer-quote-detail.tsx",
  ),
  route(
    "account/security",
    "modules/customer-identity/routes/account-security.tsx",
  ),
  route(
    "forgot-password",
    "modules/customer-identity/routes/forgot-password.tsx",
  ),
  route(
    "reset-password",
    "modules/customer-identity/routes/reset-password.tsx",
  ),
  route(
    "assembly-measurement-guide",
    "modules/storefront/routes/assembly-measurement-guide.tsx",
  ),
  route("admin", "modules/admin/routes/admin-home.tsx"),
  route("admin/quotes", "modules/admin/routes/quote-reviews.tsx"),
  route(
    "admin/quotes/:requestId/private",
    "modules/admin/routes/quote-private-review.tsx",
  ),
  route(
    "admin/quotes/:requestId/private/download",
    "modules/admin/routes/quote-private-download.ts",
  ),
  route(
    "admin/quotes/:requestId",
    "modules/admin/routes/quote-review-detail.tsx",
  ),
  route(
    "admin/settings/commercial",
    "modules/admin/routes/commercial-settings.tsx",
  ),
  route("admin/catalog/products", "modules/admin/routes/catalog-products.tsx"),
  route(
    "admin/catalog/product-editor",
    "modules/admin/routes/catalog-product-editor.ts",
  ),
  route(
    "admin/catalog/item-template",
    "modules/admin/routes/catalog-item-template.ts",
  ),
  route(
    "admin/catalog/assemblies",
    "modules/admin/routes/catalog-assemblies.tsx",
  ),
  route("admin/catalog/history", "modules/admin/routes/catalog-history.tsx"),
  route("admin/catalog/requests", "modules/admin/routes/catalog-requests.tsx"),
  route(
    "admin/catalog/bulk-import",
    "modules/admin/routes/catalog-bulk-import.tsx",
  ),
  route("admin/catalog/cutover", "modules/admin/routes/catalog-cutover.tsx"),
  route("admin/catalog/items", "modules/admin/routes/catalog-items.tsx"),
  route("admin/catalog/import", "modules/admin/routes/catalog-import.tsx"),
  route(
    "admin/catalog/commercial",
    "modules/admin/routes/catalog-commercial.tsx",
  ),
  route("admin/catalog/review", "modules/admin/routes/catalog-review.tsx"),
  route(
    "admin/catalog/reference-data",
    "modules/admin/routes/catalog-reference-data.tsx",
  ),
  route(
    "admin/diagnostics/catalog-release",
    "modules/admin/routes/catalog-release-diagnostic.tsx",
  ),
] satisfies RouteConfig;
