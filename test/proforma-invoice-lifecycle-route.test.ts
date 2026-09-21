import { beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider, type ActionFunctionArgs } from "react-router";
import { cloudflareContext } from "../workers/context";
import {
  action,
  loader,
} from "../app/modules/admin/routes/proforma-invoice-lifecycle";

const mocks = vi.hoisted(() => ({
  reserveReplacement: vi.fn(),
  replacementReadiness: vi.fn(),
  readiness: vi.fn(),
  adminHistory: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock(
  "../app/modules/proforma-invoice/application/pi-lifecycle-service",
  () => ({ createPiLifecycleService: () => mocks }),
);
vi.mock("../workers/proforma-invoice", async (original) => ({
  ...(await original<typeof import("../workers/proforma-invoice")>()),
  proformaInvoices: () => mocks,
  piPdfJobs: () => mocks,
  piLifecycle: () => mocks,
}));

const command = {
  requestId: "request",
  commandId: "ff174966-e854-431c-bd14-7d2d967548aa",
  quoteRevisionId: "quote-2",
  quoteRevisionHash: "b".repeat(64),
  sellerIdentityId: "seller",
  sellerVersion: 2,
  paymentChannel: "bank_transfer",
  paymentInstructionId: "bank",
  paymentInstructionVersion: 3,
  replacement: {
    expectedPi: {
      piId: "pi-1",
      documentVersion: 1,
      snapshotHash: "a".repeat(64),
    },
    expectedHeadVersion: 4,
    expectedAcceptanceId: "acceptance-1",
    nextQuoteRevisionId: "quote-2",
    reason: {
      code: "customer_requested_change",
      customerRequested: true,
      customerDataAccurate: true,
      explanation: "Customer changed shipment",
      evidenceIds: ["message-1"],
    },
  },
};
const actor = {
  id: "owner",
  accountType: "owner",
  email: "owner@example.test",
  canManageSubaccounts: true,
  source: "local-development",
} as const;
function args(
  options: {
    method?: string;
    origin?: string | null;
    anonymous?: boolean;
    values?: Record<string, string>;
  } = {},
): ActionFunctionArgs {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: { APP_ENV: "local", DB: {}, PRIVATE_FILES: {} } as CloudflareBindings,
    adminIdentity: options.anonymous ? undefined : actor,
    ctx: {} as ExecutionContext,
    runtime: { environment: "local" },
  });
  const url = new URL("https://example.test/admin/quotes/request/pi/lifecycle");
  const method = options.method ?? "POST";
  const request = new Request(url, {
    method,
    headers:
      options.origin === null ? {} : { Origin: options.origin ?? url.origin },
    ...(method === "POST"
      ? {
          body: new URLSearchParams(
            options.values ?? {
              intent: "replace",
              reviewed: "on",
              command: JSON.stringify(command),
            },
          ),
        }
      : {}),
  });
  return {
    context,
    params: { requestId: "request" },
    request,
    url,
    pattern: url.pathname,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.reserveReplacement.mockResolvedValue({
    commandId: command.commandId,
    piId: "pi-2",
  });
  mocks.replacementReadiness.mockResolvedValue({
    expectedHeadVersion: 4,
  });
  mocks.readiness.mockResolvedValue({ quoteRevision: { id: "quote-2" } });
  mocks.adminHistory.mockResolvedValue([]);
  mocks.dispatch.mockResolvedValue(undefined);
});
it("loads private readiness/history without mutating", async () => {
  const result = await loader(args({ method: "GET" }));
  expect(result.data.replacement).toEqual({ expectedHeadVersion: 4 });
  expect(result.init?.headers).toMatchObject({
    "Cache-Control": "private, no-store",
  });
  expect(mocks.adminHistory).toHaveBeenCalledWith(actor, "request");
  expect(mocks.reserveReplacement).not.toHaveBeenCalled();
});
it("requires admin identity, POST and same origin", async () => {
  for (const operation of [action, loader])
    await expect(operation(args({ anonymous: true }))).rejects.toMatchObject({
      status: 403,
    });
  await expect(action(args({ method: "GET" }))).rejects.toMatchObject({
    status: 405,
  });
  for (const origin of [null, "https://evil.invalid"])
    await expect(action(args({ origin }))).rejects.toMatchObject({
      status: 403,
    });
  expect(mocks.reserveReplacement).not.toHaveBeenCalled();
});
it("passes exact reviewed tokens without refreshing acceptance or head", async () => {
  expect((await action(args())).data).toEqual({
    reserved: { commandId: command.commandId, piId: "pi-2" },
  });
  expect(mocks.reserveReplacement).toHaveBeenCalledWith(actor, command);
  expect(mocks.replacementReadiness).not.toHaveBeenCalled();
});
it("rejects malformed or cross-request commands", async () => {
  for (const value of [
    "null",
    "[]",
    "{",
    JSON.stringify({ ...command, requestId: "other" }),
    JSON.stringify({ ...command, replacement: {} }),
  ]) {
    expect(
      (
        await action(
          args({
            values: { intent: "replace", reviewed: "on", command: value },
          }),
        )
      ).init?.status,
    ).toBe(400);
  }
  expect(mocks.reserveReplacement).not.toHaveBeenCalled();
});
it("requires an explicit review and preserves the durable reservation during a dispatch outage", async () => {
  expect(
    (
      await action(
        args({
          values: { intent: "replace", command: JSON.stringify(command) },
        }),
      )
    ).init?.status,
  ).toBe(400);
  expect(mocks.reserveReplacement).not.toHaveBeenCalled();
  mocks.dispatch.mockRejectedValueOnce(new Error("Queue unavailable"));
  const result = await action(args());
  expect(result.init?.status).toBe(202);
  expect(result.data).toMatchObject({
    reserved: { commandId: command.commandId },
  });
});
it("preserves conflict/authorization and uncertain retry behavior without exposing private errors", async () => {
  for (const status of [403, 404]) {
    mocks.reserveReplacement.mockRejectedValueOnce(
      new Response("Denied", { status }),
    );
    await expect(action(args())).rejects.toMatchObject({ status });
  }
  mocks.reserveReplacement.mockRejectedValueOnce(
    new Response("PRIVATE reason", { status: 409 }),
  );
  const stale = await action(args());
  expect(stale.init?.status).toBe(409);
  expect(JSON.stringify(stale.data)).not.toContain("PRIVATE");
  mocks.reserveReplacement.mockRejectedValueOnce(
    new Error("PRIVATE storage failure"),
  );
  const retry = await action(args());
  expect(retry.init?.status).toBe(503);
  expect(retry.data).toMatchObject({ commandId: command.commandId });
});
