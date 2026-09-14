import { expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import {
  loader as adminLoader,
  action as adminAction,
} from "../app/modules/admin/routes/quote-conversation";
import { loader as adminDownload } from "../app/modules/admin/routes/quote-conversation-attachment";
import {
  loader as customerLoader,
  action as customerAction,
} from "../app/modules/customer-identity/routes/customer-quote-conversation";
import { loader as customerDownload } from "../app/modules/customer-identity/routes/customer-conversation-attachment";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  list: vi.fn(),
  send: vi.fn(),
  download: vi.fn(),
}));
vi.mock(
  "../app/modules/customer-identity/application/customer-identity-service",
  () => ({
    createCustomerIdentityService: () => ({ readSession: mocks.readSession }),
  }),
);
vi.mock(
  "../app/modules/quote-conversation/application/quote-conversation-service",
  () => ({ createQuoteConversationService: () => mocks }),
);
function args(admin = false, method = "GET", origin = "http://localhost") {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: {} as CloudflareBindings,
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
  const url = new URL(
    `http://localhost/${admin ? "admin" : "account"}/quotes/q/conversation`,
  );
  return {
    context,
    request: new Request(url, {
      method,
      headers: { Origin: origin },
      ...(method === "POST"
        ? {
            body: new URLSearchParams({
              commandId: crypto.randomUUID(),
              body: "Test",
            }),
          }
        : {}),
    }),
    url,
    params: { requestId: "q", messageId: "m" },
    pattern: "/account/quotes/:requestId/conversation",
  };
}
it("rejects missing customer sessions and non-admin access on every route", async () => {
  mocks.readSession.mockResolvedValue(null);
  for (const operation of [adminLoader, adminAction, adminDownload])
    await expect(operation(args())).rejects.toMatchObject({ status: 403 });
  for (const operation of [customerLoader, customerAction, customerDownload])
    await expect(operation(args())).rejects.toMatchObject({ status: 302 });
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.download).not.toHaveBeenCalled();
});
it("fails cross-origin customer and admin forms before mutation or upload parsing", async () => {
  mocks.readSession.mockResolvedValue({ id: "profile" });
  await expect(
    customerAction(args(false, "POST", "https://evil.invalid")),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    adminAction(args(true, "POST", "https://evil.invalid")),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocks.send).not.toHaveBeenCalled();
});
it("uses owned conversation service and no-store delivery with a fresh command", async () => {
  mocks.readSession.mockResolvedValue({ id: "profile" });
  mocks.list.mockResolvedValue({ messages: [], nextCursor: null });
  const result = await customerLoader(args());
  expect(result).toMatchObject({
    data: { conversation: { messages: [] }, commandId: expect.any(String) },
    init: { headers: { "Cache-Control": "private, no-store" } },
  });
  mocks.download.mockResolvedValue(new Response("private bytes"));
  expect(await (await customerDownload(args())).text()).toBe("private bytes");
  expect(mocks.download).toHaveBeenCalledWith("q", "m");
});
