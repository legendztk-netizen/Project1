import type { RouterContextProvider } from "react-router";

import { cloudflareContext } from "#workers/context";
import type { AdminIdentity } from "#workers/admin-access";

export function adminOperationalPermissions(
  identity: Pick<AdminIdentity, "accountType" | "canManageSubaccounts">,
) {
  return {
    canMaintainOperationalSettings:
      identity.accountType === "owner" || identity.accountType === "subaccount",
    canManageSubaccounts:
      identity.accountType === "owner" && identity.canManageSubaccounts,
  };
}

export function requireAdminRequestContext(
  context: Readonly<RouterContextProvider>,
) {
  const cloudflare = context.get(cloudflareContext);
  if (!cloudflare.adminIdentity)
    throw new Response("Admin identity missing", { status: 403 });
  return {
    adminIdentity: cloudflare.adminIdentity,
    env: cloudflare.env,
  };
}

export function requireCommercialSettingsRequestContext(
  context: Readonly<RouterContextProvider>,
) {
  const requestContext = requireAdminRequestContext(context);
  if (
    !adminOperationalPermissions(requestContext.adminIdentity)
      .canMaintainOperationalSettings
  ) {
    throw new Response("Commercial settings permission required", {
      status: 403,
    });
  }
  return requestContext;
}

export function requireCatalogWriteContext(
  context: Readonly<RouterContextProvider>,
) {
  const result = requireAdminRequestContext(context);
  if (result.adminIdentity.catalogPermission === "view")
    throw new Response("需要产品编辑权限", { status: 403 });
  return result;
}
