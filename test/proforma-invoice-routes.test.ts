import { beforeEach, expect, it, vi } from "vitest";
import { matchRoutes } from "react-router";
import configuredRoutes from "../app/routes";
import { RouterContextProvider, type LoaderFunctionArgs } from "react-router";
import { cloudflareContext } from "../workers/context";
import { PiValidationError } from "../app/modules/proforma-invoice/domain/proforma-invoice";
import {
  loader as admin,
  action as issue,
  beijingDeadline,
} from "../app/modules/admin/routes/proforma-invoice";
import { loader as adminPdf } from "../app/modules/admin/routes/proforma-invoice-download";
import { loader as customer } from "../app/modules/customer-identity/routes/proforma-invoice";
import { loader as customerPdf } from "../app/modules/customer-identity/routes/proforma-invoice-download";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readiness: vi.fn(),
  issue: vi.fn(),
  adminDownload: vi.fn(),
  customerCurrent: vi.fn(),
  customerRead: vi.fn(),
  customerDownload: vi.fn(),
}));
vi.mock("../workers/pi-acceptance", () => ({
  piAcceptance: () => ({ customerStatus: async () => null }),
}));
vi.mock("../workers/proforma-invoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workers/proforma-invoice")>()),
  proformaInvoices: () => ({ ...mocks, reserve: mocks.issue }),
  piPdfJobs: () => ({ dispatch: async () => {} }),
}));
vi.mock(
  "../app/modules/customer-identity/application/customer-identity-service",
  () => ({
    createCustomerIdentityService: () => ({ readSession: mocks.readSession }),
  }),
);

it("matches the wired optional customer PI route without shadowing protected PDFs", () => {
  const routes = configuredRoutes.map((route) => ({
    path: route.path,
    id: route.file,
  }));
  for (const [path, file, piId] of [
    [
      "/admin/quotes/request/pi",
      "modules/admin/routes/proforma-invoice.tsx",
      undefined,
    ],
    [
      "/admin/quotes/request/pi/exact/pdf",
      "modules/admin/routes/proforma-invoice-download.tsx",
      "exact",
    ],
    [
      "/account/quotes/request/pi",
      "modules/customer-identity/routes/proforma-invoice.tsx",
      undefined,
    ],
    [
      "/account/quotes/request/pi/exact",
      "modules/customer-identity/routes/proforma-invoice.tsx",
      "exact",
    ],
    [
      "/account/quotes/request/pi/exact/pdf",
      "modules/customer-identity/routes/proforma-invoice-download.tsx",
      "exact",
    ],
  ] as const) {
    const match = matchRoutes(routes, path)?.at(-1);
    expect(match?.route.id).toBe(file);
    expect(match?.params.requestId).toBe("request");
    expect(match?.params.piId).toBe(piId);
  }
});

const selection = {
  id: "selected-instruction",
  version: 4,
  channel: "bank_transfer",
};
const command = {
  intent: "issue",
  commandId: "a825f421-6152-4c3c-a061-c6809f3aa343",
  quoteRevisionId: "quote-revision",
  quoteRevisionHash: "exact-captured-hash",
  sellerIdentityId: "seller",
  sellerVersion: "3",
  paymentSelection: JSON.stringify(selection),
};
function args(
  options: {
    admin?: boolean;
    method?: string;
    origin?: string | null;
    form?: Record<string, string>;
    piId?: string;
    query?: string;
  } = {},
): LoaderFunctionArgs {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: { APP_ENV: "local", DB: {}, PRIVATE_FILES: {} } as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
    ...(options.admin
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
    `http://localhost/${options.admin ? "admin" : "account"}/quotes/request/pi${options.query ?? ""}`,
  );
  const method = options.method ?? "GET";
  return {
    context,
    params: {
      requestId: "request",
      ...(options.piId ? { piId: options.piId } : {}),
    },
    request: new Request(url, {
      method,
      headers:
        options.origin === null ? {} : { Origin: options.origin ?? url.origin },
      ...(method === "POST"
        ? { body: new URLSearchParams(options.form ?? command) }
        : {}),
    }),
    url,
    pattern: url.pathname,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSession.mockResolvedValue({ id: "authenticated-profile" });
  mocks.readiness.mockResolvedValue({
    quoteRevision: { id: "quote-revision", hash: "exact-captured-hash" },
    seller: null,
    payments: [],
    conditionsConfigured: true,
    current: null,
  });
});

it("denies every admin endpoint before reaching the PI service", async () => {
  for (const route of [admin, issue, adminPdf])
    await expect(route(args())).rejects.toMatchObject({ status: 403 });
  expect(mocks.readiness).not.toHaveBeenCalled();
  expect(mocks.issue).not.toHaveBeenCalled();
  expect(mocks.adminDownload).not.toHaveBeenCalled();
});
it("rejects missing/cross-origin and non-POST issuance before service mutation", async () => {
  for (const origin of [null, "https://evil.invalid"])
    await expect(
      issue(args({ admin: true, method: "POST", origin })),
    ).rejects.toMatchObject({ status: 403 });
  await expect(issue(args({ admin: true }))).rejects.toMatchObject({
    status: 405,
  });
  expect(mocks.issue).not.toHaveBeenCalled();
});
it("returns private readiness with the exact authoritative quote hash", async () => {
  const result = await admin(args({ admin: true }));
  expect(result.data.readiness.quoteRevision?.hash).toBe("exact-captured-hash");
  expect(result.init?.headers).toMatchObject({
    "Cache-Control": "private, no-store",
  });
});
it("issues the posted versions, never silently refreshing stale selections", async () => {
  const result = await issue(args({ admin: true, method: "POST" }));
  expect(result).toMatchObject({ status: 302 });
  expect(mocks.issue).toHaveBeenCalledWith(
    expect.objectContaining({ id: "owner" }),
    {
      requestId: "request",
      commandId: command.commandId,
      quoteRevisionId: command.quoteRevisionId,
      quoteRevisionHash: command.quoteRevisionHash,
      sellerIdentityId: "seller",
      sellerVersion: 3,
      paymentChannel: "bank_transfer",
      paymentInstructionId: selection.id,
      paymentInstructionVersion: 4,
    },
  );
  expect(mocks.readiness).not.toHaveBeenCalled();
});
it("converts an explicit Beijing deadline independent of server timezone", async () => {
  expect(beijingDeadline("2026-09-30T09:30")).toBe("2026-09-30T01:30:00.000Z");
  expect(() => beijingDeadline("2026-02-30T09:30")).toThrow();
  await issue(
    args({
      admin: true,
      method: "POST",
      form: { ...command, validUntilBeijing: "2026-09-30T09:30" },
    }),
  );
  expect(mocks.issue).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ validUntil: "2026-09-30T01:30:00.000Z" }),
  );
});
it("reports stale input and missing renderer without exposing internal error details", async () => {
  for (const status of [400, 409, 503]) {
    mocks.issue.mockRejectedValueOnce(
      new Response("private-r2-key/internal-evidence", { status }),
    );
    const result = await issue(args({ admin: true, method: "POST" }));
    expect(result).toHaveProperty("init.status", status);
    expect(JSON.stringify(result)).not.toContain("private-r2-key");
    expect(result).toHaveProperty(
      "data.commandId",
      status === 503 ? command.commandId : undefined,
    );
  }
});
it("returns actionable validation failure without an infrastructure retry identity", async () => {
  mocks.issue.mockRejectedValueOnce(
    new PiValidationError("PI validity deadline must be in the future"),
  );
  const result = await issue(args({ admin: true, method: "POST" }));
  expect(result).toHaveProperty("init.status", 400);
  expect(result).toHaveProperty("data.commandId", undefined);
});
it("returns 503 for uncertain D1/R2/PDF failures and retries the submitted command", async () => {
  for (const source of ["D1", "R2", "PDF"]) {
    const failure = new Error(`${source} private internal failure`);
    failure.stack = "private stack trace";
    mocks.issue.mockRejectedValueOnce(failure);
    const result = await issue(args({ admin: true, method: "POST" }));
    expect(result).toHaveProperty("init.status", 503);
    expect(result).toHaveProperty("data.commandId", command.commandId);
    expect(JSON.stringify(result)).not.toContain("private internal failure");
    expect(JSON.stringify(result)).not.toContain("private stack trace");
    const refreshed = await admin(args({ admin: true }));
    expect(refreshed.data.commandId).not.toBe(command.commandId);
    await issue(
      args({
        admin: true,
        method: "POST",
        form: { ...command, commandId: command.commandId },
      }),
    );
    expect(mocks.issue).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ commandId: command.commandId }),
    );
  }
});
it("rejects malformed payment selection before issuance", async () => {
  const result = await issue(
    args({
      admin: true,
      method: "POST",
      form: { ...command, paymentSelection: "{}" },
    }),
  );
  expect(result).toHaveProperty("init.status", 400);
  expect(mocks.issue).not.toHaveBeenCalled();
});
it("requires a real customer session for page and PDF reads", async () => {
  mocks.readSession.mockResolvedValue(null);
  for (const route of [customer, customerPdf])
    await expect(route(args({ piId: "pi-exact" }))).rejects.toMatchObject({
      status: 302,
    });
  expect(mocks.customerRead).not.toHaveBeenCalled();
  expect(mocks.customerDownload).not.toHaveBeenCalled();
});
it("uses authenticated ownership and returns only the service's selected current instructions", async () => {
  const invoice = {
    id: "pi-exact",
    paymentInstructions: {
      ...selection,
      instructions: "Selected current instructions",
    },
  };
  mocks.customerCurrent.mockResolvedValue(invoice);
  const result = await customer(
    args({ query: "?profileId=attacker&paymentChannel=paypal" }),
  );
  expect(mocks.customerCurrent).toHaveBeenCalledWith(
    "authenticated-profile",
    "request",
  );
  expect(result.data.invoice).toEqual(invoice);
  expect(result.init?.headers).toMatchObject({
    "Cache-Control": "private, no-store",
  });
  await customer(args({ piId: "pi-exact" }));
  expect(mocks.customerRead).toHaveBeenCalledWith(
    "authenticated-profile",
    "request",
    "pi-exact",
  );
});
it("preserves ownership denial for both exact PI read and PDF download", async () => {
  mocks.customerRead.mockRejectedValue(
    new Response("Not found", { status: 404 }),
  );
  mocks.customerDownload.mockRejectedValue(
    new Response("Not found", { status: 404 }),
  );
  for (const route of [customer, customerPdf])
    await expect(
      route(args({ piId: "other-customer-pi" })),
    ).rejects.toMatchObject({ status: 404 });
});
it("streams the exact service PDF response without exposing a storage URL or regenerating", async () => {
  const response = new Response(new Uint8Array([37, 80, 68, 70]), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
    },
  });
  mocks.customerDownload.mockResolvedValue(response);
  mocks.adminDownload.mockResolvedValue(response);
  expect(
    await customerPdf(args({ piId: "pi-exact", query: "?disposition=inline" })),
  ).toBe(response);
  expect(mocks.customerDownload).toHaveBeenCalledWith(
    "authenticated-profile",
    "request",
    "pi-exact",
    "inline",
  );
  expect(await adminPdf(args({ admin: true, piId: "pi-exact" }))).toBe(
    response,
  );
  expect(mocks.adminDownload).toHaveBeenCalledWith(
    expect.objectContaining({ id: "owner" }),
    "request",
    "pi-exact",
    "attachment",
  );
  expect(mocks.issue).not.toHaveBeenCalled();
});
