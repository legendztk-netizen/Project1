import {
  canAccessAdminPath,
  canWriteAdminModule,
} from "../app/modules/admin/domain/admin-module-access";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  handle: vi.fn(async () => new Response("handled")),
}));
vi.mock("../workers/admin-access", async (original) => ({
  ...(await original<typeof import("../workers/admin-access")>()),
  authorizeAdminRequest: mocks.authorize,
}));
vi.mock("../workers/environment", () => ({
  validateRuntimeEnvironment: () => ({ environment: "local" }),
}));
vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  createRequestHandler: () => mocks.handle,
}));
import worker from "../workers/app";
import { AdminAccessDenied } from "../workers/admin-access";
const env = {
  APP_ENV: "local",
  ADMIN_AUTH_MODE: "password",
} as CloudflareBindings;
const call = (path: string, method = "GET", origin = "http://localhost") =>
  worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Origin: origin },
    }) as Request<unknown, IncomingRequestCfProperties>,
    env,
    {} as ExecutionContext,
  );
beforeEach(() => {
  mocks.handle.mockClear();
  mocks.authorize.mockReset();
  mocks.authorize.mockResolvedValue({
    id: "staff",
    accountType: "subaccount",
    moduleAccess: { catalog: "read" },
  });
});
it("blocks denied modules, unknown routes and read-only POSTs including data endpoints before loaders/actions", async () => {
  for (const [path, method] of [
    ["/admin/messages", "GET"],
    ["/admin/quotes/a/pi/x/pdf", "GET"],
    ["/admin/catalog/products", "POST"],
    ["/admin/catalog/products.data", "POST"],
    ["/admin/settings/permissions", "POST"],
    ["/admin/unknown", "GET"],
  ])
    expect((await call(path, method)).status).toBe(403);
  expect(mocks.handle).not.toHaveBeenCalled();
  expect((await call("/admin/catalog/products.data")).status).toBe(200);
});
it("rejects missing sessions and cross-origin writes even for Owner", async () => {
  mocks.authorize.mockRejectedValue(
    new AdminAccessDenied("login required", 401),
  );
  expect((await call("/admin/orders")).status).toBe(401);
  mocks.authorize.mockResolvedValue({ id: "owner", accountType: "owner" });
  expect(
    (await call("/admin/settings/permissions", "POST", "https://foreign.test"))
      .status,
  ).toBe(403);
  expect(mocks.handle).not.toHaveBeenCalled();
});
it("allows same-origin authorized writes and keeps admin responses uncached", async () => {
  mocks.authorize.mockResolvedValue({
    id: "staff",
    accountType: "subaccount",
    moduleAccess: { orders: "write" },
  });
  const response = await call("/admin/orders/a.data", "POST");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.handle).toHaveBeenCalledOnce();
});

it("separates order editing from after-sales editing on their shared action endpoint", () => {
  const afterSales = {
    accountType: "subaccount",
    moduleAccess: { orders: "read" as const, after_sales: "write" as const },
  };
  expect(canAccessAdminPath(afterSales, "/admin/orders/a.data", "POST")).toBe(
    true,
  );
  expect(canWriteAdminModule(afterSales, "after_sales")).toBe(true);
  expect(canWriteAdminModule(afterSales, "orders")).toBe(false);
  const orderEditor = {
    accountType: "subaccount",
    moduleAccess: { orders: "write" as const, after_sales: "read" as const },
  };
  expect(canWriteAdminModule(orderEditor, "after_sales")).toBe(false);
  expect(canWriteAdminModule(orderEditor, "orders")).toBe(true);
});

it("admits personal notification read-state POSTs for read-only accounts, but not business writes", async () => {
  mocks.authorize.mockResolvedValue({
    id: "staff",
    accountType: "subaccount",
    moduleAccess: { notifications: "read", quotes: "read" },
  });
  expect((await call("/admin/notifications.data", "POST")).status).toBe(200);
  expect((await call("/admin/quotes/a", "POST")).status).toBe(403);
  expect((await call("/admin/notifications/unread-count", "POST")).status).toBe(
    403,
  );
});

it("separates configurator from catalog on GET and POST including catalog view and item publication gates", async () => {
  mocks.authorize.mockResolvedValue({
    id: "staff",
    accountType: "subaccount",
    catalogPermission: "view",
    moduleAccess: { configurator: "write" },
  });
  expect(
    (await call("/admin/catalog/reference-data.data", "POST")).status,
  ).toBe(200);
  expect((await call("/admin/catalog/products", "GET")).status).toBe(403);
  mocks.authorize.mockResolvedValue({
    id: "staff",
    accountType: "subaccount",
    moduleAccess: { catalog: "write" },
  });
  expect((await call("/admin/catalog/reference-data", "GET")).status).toBe(403);
  expect(
    (await call("/admin/catalog/reference-data.data", "POST")).status,
  ).toBe(403);
  mocks.authorize.mockResolvedValue({
    id: "staff",
    accountType: "subaccount",
    moduleAccess: { configurator: "read" },
  });
  expect((await call("/admin/catalog/reference-data", "GET")).status).toBe(200);
  expect((await call("/admin/catalog/reference-data", "POST")).status).toBe(
    403,
  );
});
