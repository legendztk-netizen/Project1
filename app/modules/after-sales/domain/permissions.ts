import type { AdminIdentity } from "#workers/admin-access";

export type AfterSalesPermission = "after_sales.review" | "after_sales.refund";

/**
 * Owner holds every permission. Subaccounts need an explicit Owner-granted
 * permission; after-sales authority is never inferred from a role name.
 */
export function hasAfterSalesPermission(
  actor: AdminIdentity | null | undefined,
  permission: AfterSalesPermission,
) {
  if (!actor?.id) return false;
  if (actor.accountType === "owner") return true;
  return (
    actor.accountType === "subaccount" &&
    (actor.permissions ?? []).includes(permission)
  );
}

export function requireAfterSalesPermission(
  actor: AdminIdentity | null | undefined,
  permission: AfterSalesPermission,
) {
  if (!hasAfterSalesPermission(actor, permission))
    throw new Response("Forbidden", { status: 403 });
  return actor as AdminIdentity;
}

export function requireOwner(actor: AdminIdentity | null | undefined) {
  if (!actor?.id || actor.accountType !== "owner")
    throw new Response("Owner approval required", { status: 403 });
  return actor;
}
