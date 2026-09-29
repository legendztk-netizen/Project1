import { expect, it } from "vitest";
import { RouterContextProvider } from "react-router";

import { cloudflareContext } from "../workers/context";
import { action, loader } from "../app/modules/admin/routes/shipment-documents";
import { loader as download } from "../app/modules/admin/routes/shipment-document-download";

it("rejects unauthenticated admin document routes before touching storage", async () => {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: {} as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
  });
  const url = new URL(
    "http://admin.localhost/admin/orders/order-1/shipments/shipment-1",
  );
  const args = {
    context,
    request: new Request(url),
    url,
    params: {
      orderId: "order-1",
      shipmentId: "shipment-1",
      documentId: "document-1",
    },
    pattern: "/admin/orders/:orderId/shipments/:shipmentId",
  };
  await expect(loader(args)).rejects.toMatchObject({ status: 403 });
  await expect(action(args)).rejects.toMatchObject({ status: 403 });
  await expect(
    download({ ...args, pattern: `${args.pattern}/:documentId/download` }),
  ).rejects.toMatchObject({ status: 403 });
});

it("keeps the editor visible when an upload exceeds the request limit", async () => {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: {} as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
    adminIdentity: {
      id: "test-owner",
      email: "owner@example.test",
      accountType: "owner",
      canManageSubaccounts: true,
      source: "local-development",
    },
  });
  const url = new URL(
    "http://admin.localhost/admin/orders/order-1/shipments/shipment-1",
  );
  const result = await action({
    context,
    request: new Request(url, {
      method: "POST",
      headers: {
        Origin: url.origin,
        "Content-Length": String(11 * 1024 * 1024),
      },
      body: "oversized",
    }),
    url,
    params: { orderId: "order-1", shipmentId: "shipment-1" },
    pattern: "/admin/orders/:orderId/shipments/:shipmentId",
  });
  expect(result).not.toBeInstanceOf(Response);
  expect(result).toHaveProperty("data.error", "文件超过 10 MB 限制。");
});
