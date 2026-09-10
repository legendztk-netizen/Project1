import { expect, it } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import { action, loader } from "../app/modules/admin/routes/catalog-requests";
import { createD1ItemImportReview } from "../app/modules/catalog/infrastructure/d1-item-import-review";
it("denies unauthorized reads and read-only mutations before reading forms or D1", async () => {
  const context = new RouterContextProvider();
  const base = {
    env: {} as CloudflareBindings,
    runtime: { environment: "local" as const },
    ctx: {} as ExecutionContext,
  };
  context.set(cloudflareContext, { ...base, adminIdentity: undefined });
  const args = {
    context,
    request: new Request("http://admin.localhost/admin/catalog/requests"),
    params: {},
    url: new URL("http://admin.localhost/admin/catalog/requests"),
    pattern: "/admin/catalog/requests",
  } as Parameters<typeof loader>[0];
  await expect(loader(args)).rejects.toMatchObject({ status: 403 });
  context.set(cloudflareContext, {
    ...base,
    adminIdentity: {
      id: "viewer",
      email: "viewer@example.com",
      accountType: "subaccount",
      source: "cloudflare-access",
      canManageSubaccounts: false,
      catalogPermission: "view",
    },
  });
  await expect(action(args)).rejects.toMatchObject({ status: 403 });
  const repository = createD1ItemImportReview({} as D1Database, {
    id: "viewer",
    catalogPermission: "view",
  });
  await expect(
    repository.review({
      selected: [],
      intent: "approve",
      actorId: "viewer",
      ipAddress: "local",
    }),
  ).rejects.toMatchObject({ status: 403 });
});

it("requires an administrator for legacy history and rejects all history mutations", async () => {
  const history = await import("../app/modules/admin/routes/catalog-history");
  const context = new RouterContextProvider();
  const base = {
    env: {} as CloudflareBindings,
    runtime: { environment: "local" as const },
    ctx: {} as ExecutionContext,
  };
  context.set(cloudflareContext, { ...base, adminIdentity: undefined });
  const args = {
    context,
    request: new Request("http://admin.localhost/admin/catalog/history"),
    url: new URL("http://admin.localhost/admin/catalog/history"),
    pattern: "/admin/catalog/history",
    params: {},
  } as Parameters<typeof history.loader>[0];
  await expect(history.loader(args)).rejects.toMatchObject({ status: 403 });
  await expect(history.action(args)).rejects.toMatchObject({ status: 403 });
  context.set(cloudflareContext, {
    ...base,
    adminIdentity: {
      id: "viewer",
      email: "viewer@example.com",
      accountType: "subaccount",
      source: "cloudflare-access",
      canManageSubaccounts: false,
      catalogPermission: "view",
    },
  });
  await expect(history.action(args)).rejects.toMatchObject({ status: 405 });
});
