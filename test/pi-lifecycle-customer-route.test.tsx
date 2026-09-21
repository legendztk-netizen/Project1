// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  MemoryRouter,
  RouterContextProvider,
  type LoaderFunctionArgs,
} from "react-router";
import type { ReactNode } from "react";
import Page, {
  loader,
} from "../app/modules/customer-identity/routes/proforma-invoice";
import { cloudflareContext } from "../workers/context";
import { publicPiLifecycle } from "../app/modules/proforma-invoice/domain/pi-lifecycle";
import type { PiRecord } from "../workers/proforma-invoice";
import type { PiAcceptanceStatus } from "../workers/pi-acceptance";
const mocks = vi.hoisted(() => ({
  customerRead: vi.fn(),
  customerCurrent: vi.fn(),
  customerHistory: vi.fn(),
  customerStatus: vi.fn(),
  profile: vi.fn(),
}));
vi.mock("../workers/proforma-invoice", async (original) => ({
  ...(await original<typeof import("../workers/proforma-invoice")>()),
  proformaInvoices: () => mocks,
  piLifecycle: () => mocks,
  piCustomerProfile: mocks.profile,
}));
vi.mock("../workers/pi-acceptance", () => ({ piAcceptance: () => mocks }));
vi.mock("../app/modules/customer-identity/ui/account-workspace", () => ({
  AccountWorkspace: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
afterEach(cleanup);
const invoice = {
  id: "pi",
  requestId: "request",
  quoteRevisionId: "quote",
  snapshotHash: "a".repeat(64),
  snapshot: {
    documentNumber: "PI-EXACT",
    documentVersion: 1,
    issuedAt: "2026-09-14T00:00:00.000Z",
    validUntil: "2026-09-28T00:00:00.000Z",
    quoteRevision: { number: 1 },
    totals: { totalCents: 12345 },
    seller: { legalName: "Seller", registeredAddressEn: "China" },
  },
  paymentInstructions: {
    channel: "bank_transfer",
    version: 3,
    instructions: "CURRENT BANK DETAILS",
  },
} as unknown as PiRecord;
const status: PiAcceptanceStatus = {
  piId: "pi",
  documentVersion: 1,
  snapshotHash: invoice.snapshotHash,
  current: true,
  expired: false,
  status: "PI Ready",
  canAccept: false,
  viewId: null,
  acceptance: null,
};
function history(
  state: "current" | "accepted" | "expired" | "superseded",
  awaiting = false,
) {
  const target = {
    piId: "pi",
    documentVersion: 1,
    snapshotHash: invoice.snapshotHash,
  };
  const lifecycle = publicPiLifecycle(
    {
      ...target,
      requestId: "request",
      quoteRevisionId: "quote",
      totalCents: 12345,
      issuedAt: invoice.snapshot.issuedAt,
      validUntil: invoice.snapshot.validUntil,
      acceptance:
        state === "accepted" || state === "superseded"
          ? {
              ...target,
              id: "accepted",
              acceptedAt: "2026-09-15T00:00:00.000Z",
            }
          : null,
      supersededAt: state === "superseded" ? "2026-09-16T00:00:00.000Z" : null,
      supersededByPiId: state === "superseded" ? "new-pi" : null,
    },
    {
      currentPiId: state === "superseded" ? "new-pi" : "pi",
      currentQuoteRevisionId: awaiting ? "new-quote" : "quote",
      now: "2026-09-29T00:00:00.000Z",
    },
  );
  // The ready case uses an instant before deadline; accepted must survive after it.
  return [
    {
      id: invoice.id,
      requestId: invoice.requestId,
      snapshotHash: invoice.snapshotHash,
      snapshot: {
        documentNumber: invoice.snapshot.documentNumber,
        documentVersion: invoice.snapshot.documentVersion,
        issuedAt: invoice.snapshot.issuedAt,
        totals: invoice.snapshot.totals,
      },
      lifecycle:
        state === "current"
          ? {
              ...lifecycle,
              state: "current" as const,
              label: "Current",
              canAccept: !awaiting,
            }
          : lifecycle,
    },
  ];
}
function args(): LoaderFunctionArgs {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: { DB: {}, PRIVATE_FILES: {} } as CloudflareBindings,
    ctx: {} as ExecutionContext,
    runtime: { environment: "local" },
  });
  const url = new URL("https://example.test/account/quotes/request/pi/pi");
  return {
    context,
    request: new Request(url),
    params: { requestId: "request", piId: "pi" },
    url,
    pattern: url.pathname,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.profile.mockResolvedValue("verified-profile");
  mocks.customerRead.mockResolvedValue(invoice);
  mocks.customerStatus.mockResolvedValue(status);
  mocks.customerHistory.mockResolvedValue(history("current"));
});
it("loads owned historical versions while retaining the acceptance service status", async () => {
  const result = await loader(args());
  expect(mocks.customerHistory).toHaveBeenCalledWith(
    "verified-profile",
    "request",
  );
  expect(mocks.customerStatus).toHaveBeenCalledWith(
    "verified-profile",
    "request",
    "pi",
  );
  expect(result.data.status).toBe(status);
  expect(result.data.history).toEqual(history("current"));
  expect(result.init?.headers).toMatchObject({
    "Cache-Control": "private, no-store",
  });
  mocks.customerHistory.mockRejectedValueOnce(
    new Response("Not found", { status: 404 }),
  );
  await expect(loader(args())).rejects.toMatchObject({ status: 404 });
});
it("strips serialized instructions when replacement happens after the invoice read", async () => {
  mocks.customerRead.mockImplementationOnce(async () => {
    mocks.customerHistory.mockResolvedValueOnce(history("superseded"));
    return invoice;
  });
  const result = await loader(args());
  expect(result.data.status).toBe(status);
  expect(result.data.history[0].lifecycle.state).toBe("superseded");
  expect(result.data.invoice?.paymentInstructions).toBeNull();
  expect(JSON.stringify(result.data)).not.toContain("CURRENT BANK DETAILS");
  expect(invoice.paymentInstructions?.instructions).toBe(
    "CURRENT BANK DETAILS",
  );
});
it.each(["current", "accepted"] as const)(
  "retains instructions for latest %s lifecycle",
  async (state) => {
    mocks.customerHistory.mockResolvedValueOnce(history(state));
    const result = await loader(args());
    expect(result.data.invoice?.paymentInstructions).toEqual(
      invoice.paymentInstructions,
    );
  },
);
it("fails closed when the latest history no longer contains the invoice", async () => {
  mocks.customerHistory.mockResolvedValueOnce([]);
  expect((await loader(args())).data.invoice?.paymentInstructions).toBeNull();
});
it.each(["superseded", "expired"] as const)(
  "keeps %s history readable but hides payments and new acceptance",
  (state) => {
    render(
      <MemoryRouter>
        <Page
          loaderData={{
            requestId: "request",
            invoice,
            status: {
              ...status,
              current: state !== "superseded",
              expired: true,
            },
            history: history(state),
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText("CURRENT BANK DETAILS")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Payment instructions" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Review and accept/ }),
    ).toBeNull();
    const region = within(screen.getByRole("region", { name: "PI history" }));
    expect(
      region.getByText(state === "superseded" ? "Superseded" : "Expired"),
    ).toBeTruthy();
    expect(
      region.getByRole("link", { name: "Download PDF" }).getAttribute("href"),
    ).toBe("/account/quotes/request/pi/pi/pdf");
    expect(
      region.getByText(/Issued \(ET\): Sep 13, 2026, 20:00:00/),
    ).toBeTruthy();
  },
);
it("retains current accepted instructions after expiry and exposes the original acceptance record", () => {
  render(
    <MemoryRouter>
      <Page
        loaderData={{
          requestId: "request",
          invoice,
          status: {
            ...status,
            expired: true,
            status: "PI Accepted",
            acceptance: { id: "accepted" } as NonNullable<
              PiAcceptanceStatus["acceptance"]
            >,
          },
          history: history("accepted"),
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("CURRENT BANK DETAILS")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Acceptance record" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Review and accept/ })).toBeNull();
});
it("hides payment and acceptance while an unaccepted current PI awaits replacement", () => {
  render(
    <MemoryRouter>
      <Page
        loaderData={{
          requestId: "request",
          invoice,
          status: { ...status, current: false },
          history: history("current", true),
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByText("CURRENT BANK DETAILS")).toBeNull();
  expect(screen.queryByRole("link", { name: /Review and accept/ })).toBeNull();
  expect(screen.getAllByText("Updated PI pending").length).toBeGreaterThan(0);
});
