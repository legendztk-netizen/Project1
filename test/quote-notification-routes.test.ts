import { beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import {
  loader,
  action,
} from "../app/modules/admin/routes/quote-notifications";
import { loader as capture } from "../app/modules/admin/routes/quote-notification-capture";
const mocks = vi.hoisted(() => ({
  listAdmin: vi.fn(),
  dispatch: vi.fn(),
  readLocalCapture: vi.fn(),
}));
vi.mock("../workers/quote-notifications", () => ({
  quoteNotifications: async () => mocks,
}));
beforeEach(() => vi.clearAllMocks());
function args(admin = false, method = "GET", origin = "http://localhost") {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: { APP_ENV: "local", ASYNC_JOBS: {} } as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
    ...(admin
      ? {
          adminIdentity: {
            id: "owner",
            email: "owner@local.invalid",
            accountType: "owner" as const,
            canManageSubaccounts: true,
            source: "local-development" as const,
          },
        }
      : {}),
  });
  const url = new URL("http://localhost/admin/quote-notifications");
  return {
    context,
    request: new Request(url, { method, headers: { Origin: origin } }),
    url,
    params: { notificationId: "notice" },
    pattern: "/admin/quote-notifications",
  };
}
it("denies every notification endpoint without Admin identity", async () => {
  for (const operation of [loader, action, capture])
    await expect(operation(args())).rejects.toMatchObject({ status: 403 });
  expect(mocks.listAdmin).not.toHaveBeenCalled();
});
it("requires same-origin mutation before dispatch", async () => {
  await expect(
    action(args(true, "POST", "https://evil.invalid")),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect((await action(args(true, "POST"))).status).toBe(302);
});
it("returns captured email as private structured data for escaped rendering", async () => {
  mocks.readLocalCapture.mockResolvedValue({
    from: "quotes@local.invalid",
    to: ["customer@example.com"],
    reply_to: "opaque@reply.local.invalid",
    subject: "Quote",
    text: "<script>alert(1)</script>",
  });
  const response = await capture(args(true));
  expect(response.init?.headers).toMatchObject({
    "Cache-Control": "private, no-store",
  });
  expect(response.data.email.text).toBe("<script>alert(1)</script>");
});
