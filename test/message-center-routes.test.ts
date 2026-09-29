import { expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import { loader as adminRedirect } from "../app/modules/admin/routes/quote-conversation";
import {
  loader as adminLoader,
  action as adminAction,
} from "../app/modules/admin/routes/message-thread";
import { loader as adminInbox } from "../app/modules/admin/routes/messages";
import { loader as adminDownload } from "../app/modules/admin/routes/quote-conversation-attachment";
import { loader as customerRedirect } from "../app/modules/customer-identity/routes/customer-quote-conversation";
import {
  loader as customerLoader,
  action as customerAction,
} from "../app/modules/customer-identity/routes/customer-message-thread";
import { loader as customerInbox } from "../app/modules/customer-identity/routes/customer-messages";
import { loader as customerDownload } from "../app/modules/customer-identity/routes/customer-conversation-attachment";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  list: vi.fn(),
  thread: vi.fn(),
  threads: vi.fn(),
  unreadThreads: vi.fn(),
  send: vi.fn(),
  addNote: vi.fn(),
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
vi.mock(
  "../app/modules/message-center/application/message-center-service",
  () => ({
    adminThreadFilter: (value: string | null) =>
      value === "unread" || value === "awaiting" ? value : "all",
    createMessageCenter: () => ({ admin: () => mocks, customer: () => mocks }),
  }),
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
    `http://localhost/${admin ? "admin" : "account"}/messages/q`,
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
    pattern: "/account/messages/:requestId",
  };
}
it("rejects missing customer sessions and non-admin access on every route", async () => {
  mocks.readSession.mockResolvedValue(null);
  for (const operation of [
    adminLoader,
    adminAction,
    adminInbox,
    adminDownload,
    adminRedirect,
  ])
    await expect((async () => operation(args()))()).rejects.toMatchObject({
      status: 403,
    });
  for (const operation of [
    customerLoader,
    customerAction,
    customerInbox,
    customerDownload,
  ])
    await expect(operation(args())).rejects.toMatchObject({ status: 302 });
  expect(mocks.thread).not.toHaveBeenCalled();
  expect(mocks.threads).not.toHaveBeenCalled();
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
  expect(mocks.addNote).not.toHaveBeenCalled();
});
it("serves threads privately with fresh commands and redirects old conversation links", async () => {
  mocks.readSession.mockResolvedValue({ id: "profile" });
  mocks.thread.mockResolvedValue({
    messages: { messages: [], nextCursor: null },
    context: { cases: [] },
  });
  const result = await customerLoader(args());
  expect(result).toMatchObject({
    data: {
      messages: { messages: [] },
      commandId: expect.any(String),
      paged: false,
    },
    init: { headers: { "Cache-Control": "private, no-store" } },
  });
  expect(mocks.thread).toHaveBeenCalledWith("q", undefined);
  const admin = await adminLoader(args(true));
  expect(admin).toMatchObject({
    data: {
      commandId: expect.any(String),
      noteCommandId: expect.any(String),
    },
  });
  mocks.download.mockResolvedValue(new Response("private bytes"));
  expect(await (await customerDownload(args())).text()).toBe("private bytes");
  expect(mocks.download).toHaveBeenCalledWith("q", "m");
  const customerOld = customerRedirect(args()) as Response;
  expect(customerOld.headers.get("Location")).toBe("/account/messages/q");
  const adminOld = adminRedirect(args(true)) as Response;
  expect(adminOld.headers.get("Location")).toBe("/admin/messages/q");
});

it("routes an Admin internal note to the note command, never to the customer", async () => {
  const request = new Request("http://localhost/admin/messages/q", {
    method: "POST",
    headers: { Origin: "http://localhost" },
    body: new URLSearchParams({
      intent: "note",
      commandId: crypto.randomUUID(),
      body: "Internal only",
      caseId: "case-1",
    }),
  });
  const response = (await adminAction({
    ...args(true),
    request,
  })) as Response;
  expect(response.headers.get("Location")).toBe("/admin/messages/q#latest");
  expect(mocks.addNote).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: "q",
      caseId: "case-1",
      body: "Internal only",
    }),
  );
  expect(mocks.send).not.toHaveBeenCalled();
});
