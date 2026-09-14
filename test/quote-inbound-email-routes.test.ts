import { beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import {
  loader,
  action,
} from "../app/modules/admin/routes/quote-inbound-email";
const mocks = vi.hoisted(() => ({ listAdmin: vi.fn(), dispatch: vi.fn() }));
vi.mock("../workers/quote-inbound-email", () => ({
  quoteInboundEmail: async () => mocks,
  dispatchInboundEmail: mocks.dispatch,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAdmin.mockResolvedValue({ rows: [], nextCursor: null });
});
function args(
  admin = false,
  method = "GET",
  origin = "http://localhost",
  query = "",
) {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: { APP_ENV: "local" } as CloudflareBindings,
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
  const url = new URL(`http://localhost/admin/quote-inbound-email${query}`);
  return {
    context,
    request: new Request(url, { method, headers: { Origin: origin } }),
    url,
    params: {},
    pattern: "/admin/quote-inbound-email",
  };
}
it("denies listing and mutations without Admin", async () => {
  await expect(loader(args())).rejects.toMatchObject({ status: 403 });
  await expect(action(args())).rejects.toMatchObject({ status: 403 });
  expect(mocks.listAdmin).not.toHaveBeenCalled();
});
it("requires same-origin for recovery dispatch", async () => {
  await expect(
    action(args(true, "POST", "https://evil.invalid")),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect((await action(args(true, "POST"))).status).toBe(302);
});
it("defaults to quarantine and forwards older-page cursors without public caching", async () => {
  const result = await loader(
    args(true, "GET", "http://localhost", "?cursor=older"),
  );
  expect(mocks.listAdmin).toHaveBeenCalledWith(expect.anything(), {
    state: "quarantined",
    cursor: "older",
  });
  expect(result.init?.headers).toMatchObject({
    "Cache-Control": "private, no-store",
  });
});
