// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
  RouterContextProvider,
  RouterProvider,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import type { ReactNode } from "react";
import { cloudflareContext } from "../workers/context";
import Page, {
  action,
  loader,
  type AcceptancePageData,
} from "../app/modules/customer-identity/routes/proforma-invoice-accept";
import PiPage, {
  loader as piLoader,
} from "../app/modules/customer-identity/routes/proforma-invoice";
import { loader as pdfLoader } from "../app/modules/customer-identity/routes/proforma-invoice-download";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  customerRead: vi.fn(),
  customerStatus: vi.fn(),
  accept: vi.fn(),
  customerView: vi.fn(),
  customerDownload: vi.fn(),
}));
vi.mock("../workers/pi-acceptance", async (original) => ({
  ...(await original<typeof import("../workers/pi-acceptance")>()),
  piAcceptance: () => mocks,
}));
vi.mock("../workers/proforma-invoice", async (original) => ({
  ...(await original<typeof import("../workers/proforma-invoice")>()),
  proformaInvoices: () => mocks,
  piLifecycle: () => ({ customerHistory: async () => [] }),
}));
vi.mock(
  "../app/modules/customer-identity/application/customer-identity-service",
  () => ({
    createCustomerIdentityService: () => ({ readSession: mocks.readSession }),
  }),
);
vi.mock("../app/modules/customer-identity/ui/account-workspace", () => ({
  AccountWorkspace: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const hash = "a".repeat(64);
const policies = [
  { lineId: "line-a", version: "spec-v1", cancellationVersion: "cancel-v1" },
  { lineId: "line-b", version: "spec-v2", cancellationVersion: "cancel-v1" },
];
const form = {
  intent: "accept",
  piId: "pi-exact",
  documentVersion: "2",
  snapshotHash: hash,
  commandId: "ff174966-e854-431c-bd14-7d2d967548aa",
  viewId: "real-view",
  legalName: "Legal Customer",
  generalVersion: "general-v1",
  generalConfirmed: "on",
  linePolicies: JSON.stringify(policies),
  "specifications-0": "on",
  "cancellation-0": "on",
  "specifications-1": "on",
  "cancellation-1": "on",
};
const page = {
  requestId: "request",
  commandId: form.commandId,
  invoice: {
    id: "pi-exact",
    snapshotHash: hash,
    snapshot: {
      documentNumber: "PI-EXACT",
      documentVersion: 2,
      validUntil: "2026-10-01T00:00:00.000Z",
      lines: [
        {
          id: "line-a",
          displayName: "Custom hose A",
          sku: "A",
          quantity: 2,
          salesUnit: "assembly",
        },
        {
          id: "line-b",
          displayName: "Custom hose B",
          sku: "B",
          quantity: 3,
          salesUnit: "assembly",
        },
      ],
      conditions: {
        generalAcknowledgement: {
          version: "general-v1",
          text: "I confirm the general commercial terms.",
        },
        cancellation: {
          version: "cancel-v1",
          text: "Cancellation requires review.",
        },
        refund: { version: "refund-v1", text: "Refund conditions apply." },
        madeToOrderAcknowledgements: policies.map((policy) => ({
          lineId: policy.lineId,
          version: policy.version,
          text: `I confirm specifications for ${policy.lineId}.`,
        })),
      },
    },
  },
  status: {
    piId: "pi-exact",
    documentVersion: 2,
    snapshotHash: hash,
    current: true,
    expired: false,
    status: "PI Ready",
    canAccept: true,
    viewId: "real-view",
    acceptance: null,
  },
} as unknown as AcceptancePageData;

function args(
  options: {
    method?: string;
    origin?: string | null;
    values?: Record<string, string>;
  } = {},
): LoaderFunctionArgs {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: { APP_ENV: "local", DB: {}, PRIVATE_FILES: {} } as CloudflareBindings,
    ctx: {} as ExecutionContext,
    runtime: { environment: "local" },
  });
  const url = new URL(
    "http://localhost/account/quotes/request/pi/pi-exact/accept",
  );
  const method = options.method ?? "GET";
  const request = new Request(url, {
    method,
    ...(method === "POST"
      ? { body: new URLSearchParams(options.values ?? form) }
      : {}),
  });
  // Simulate incoming server headers, not browser-forbidden outgoing Request headers.
  if (options.origin !== null)
    request.headers.set("Origin", options.origin ?? url.origin);
  request.headers.set("CF-Connecting-IP", "203.0.113.8");
  request.headers.set("User-Agent", "actual-browser");
  request.headers.set("cf-ray", "actual-request");
  return {
    context,
    params: { requestId: "request", piId: "pi-exact" },
    url,
    pattern: url.pathname,
    request,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSession.mockResolvedValue({ id: "verified-profile" });
  mocks.customerRead.mockResolvedValue(page.invoice);
  mocks.customerStatus.mockResolvedValue(page.status);
});
afterEach(cleanup);

it("records only version-scoped GET PDF delivery with server request evidence", async () => {
  for (const kind of ["view", "download"] as const) {
    const input = args();
    const url = new URL(input.request.url.replace(/accept$/, "pdf"));
    url.search = new URLSearchParams({
      documentVersion: "2",
      snapshotHash: hash,
      disposition: kind === "view" ? "inline" : "attachment",
    }).toString();
    input.request = new Request(url, { headers: input.request.headers });
    const response = new Response("PDF");
    mocks.customerView.mockResolvedValue({ response });
    expect(await pdfLoader(input)).toBe(response);
    expect(mocks.customerView).toHaveBeenLastCalledWith(
      "verified-profile",
      "request",
      { piId: "pi-exact", documentVersion: 2, snapshotHash: hash },
      kind,
      {
        requestId: "actual-request",
        ipAddress: "203.0.113.8",
        userAgent: "actual-browser",
      },
    );
  }
  expect(mocks.customerDownload).not.toHaveBeenCalled();
});

it("rejects partial or invalid PDF targets and HEAD before recording viewing", async () => {
  for (const query of [
    "documentVersion=2",
    `snapshotHash=${hash}`,
    `documentVersion=0&snapshotHash=${hash}`,
    `documentVersion=1.5&snapshotHash=${hash}`,
  ]) {
    const input = args();
    input.request = new Request(`${input.request.url}?${query}`);
    await expect(pdfLoader(input)).rejects.toMatchObject({ status: 400 });
  }
  const input = args();
  input.request = new Request(
    `${input.request.url}?documentVersion=2&snapshotHash=${hash}`,
    { method: "HEAD" },
  );
  await expect(pdfLoader(input)).rejects.toMatchObject({ status: 405 });
  expect(mocks.customerView).not.toHaveBeenCalled();
});

it("preserves historical PDF delivery without creating acceptance evidence", async () => {
  const response = new Response("historical PDF");
  mocks.customerDownload.mockResolvedValue(response);
  expect(await pdfLoader(args())).toBe(response);
  expect(mocks.customerView).not.toHaveBeenCalled();
});

it("does not fall back to an unscoped download when versioned viewing fails", async () => {
  const input = args();
  input.request = new Request(
    `${input.request.url}?documentVersion=2&snapshotHash=${hash}`,
  );
  mocks.customerView.mockRejectedValue(new Response("Stale", { status: 409 }));
  await expect(pdfLoader(input)).rejects.toMatchObject({ status: 409 });
  expect(mocks.customerDownload).not.toHaveBeenCalled();
});

it("keeps expired and superseded acceptance pages linked to read-only historical PDFs", () => {
  for (const status of [
    { ...page.status, current: false },
    { ...page.status, expired: true },
  ]) {
    const router = createMemoryRouter([
      { path: "/", element: <Page loaderData={{ ...page, status }} /> },
    ]);
    const rendered = render(<RouterProvider router={router} />);
    const href = screen
      .getByRole("link", { name: "View PI" })
      .getAttribute("href")!;
    expect(href).toContain("disposition=inline");
    expect(href).not.toContain("snapshotHash");
    expect(href).not.toContain("documentVersion");
    rendered.unmount();
  }
});

it("projects acceptance on the customer PI page and links its immutable record", async () => {
  const invoice = {
    ...page.invoice,
    snapshot: {
      ...page.invoice.snapshot,
      issuedAt: "2026-09-14T00:00:00.000Z",
      quoteRevision: { ...page.invoice.snapshot.quoteRevision, number: 1 },
      totals: { ...page.invoice.snapshot.totals, totalCents: 100 },
      seller: {
        legalName: "Hangzhou Rongyao Trading Co., Ltd.",
        registeredAddressEn: "Address",
      },
    },
  } as AcceptancePageData["invoice"];
  mocks.customerRead.mockResolvedValue(invoice);
  mocks.customerStatus.mockResolvedValue({
    ...page.status,
    acceptance: { id: "accepted" },
    status: "PI Accepted",
    canAccept: false,
  });
  const result = await piLoader(args());
  render(
    <RouterProvider
      router={createMemoryRouter([
        { path: "/", element: <PiPage loaderData={result.data} /> },
      ])}
    />,
  );
  expect(screen.getByRole("heading", { name: "PI Accepted" })).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Acceptance record" })
      .getAttribute("href"),
  ).toBe("/account/quotes/request/pi/pi-exact/accept");
  expect(
    screen.getByRole("link", { name: "View PI" }).getAttribute("href"),
  ).toContain(`snapshotHash=${hash}`);
});

it("requires authentication before PI read or acceptance", async () => {
  mocks.readSession.mockResolvedValue(null);
  for (const operation of [loader, action])
    await expect(operation(args({ method: "POST" }))).rejects.toMatchObject({
      status: 302,
    });
  expect(mocks.customerRead).not.toHaveBeenCalled();
  expect(mocks.accept).not.toHaveBeenCalled();
});
it("rejects missing/cross-origin and non-POST acceptance", async () => {
  for (const origin of [null, "https://evil.invalid"])
    await expect(
      action(args({ method: "POST", origin })),
    ).rejects.toMatchObject({ status: 403 });
  await expect(action(args())).rejects.toMatchObject({ status: 405 });
  expect(mocks.accept).not.toHaveBeenCalled();
});
it("loads only owned exact status and never records a view on page load", async () => {
  const result = await loader(args());
  expect(mocks.customerRead).toHaveBeenCalledWith(
    "verified-profile",
    "request",
    "pi-exact",
  );
  expect(mocks.customerStatus).toHaveBeenCalledWith(
    "verified-profile",
    "request",
    "pi-exact",
  );
  expect(result.data.status.viewId).toBe("real-view");
  expect(result.init?.headers).toMatchObject({
    "Cache-Control": "private, no-store",
  });
  expect(mocks.customerView).not.toHaveBeenCalled();
  mocks.customerRead.mockRejectedValueOnce(
    new Response("Not found", { status: 404 }),
  );
  await expect(loader(args())).rejects.toMatchObject({ status: 404 });
});
it("rejects mismatched snapshot/status versions", async () => {
  mocks.customerStatus.mockResolvedValue({
    ...page.status,
    snapshotHash: "b".repeat(64),
  });
  await expect(loader(args())).rejects.toMatchObject({ status: 409 });
});
it("requires legal name, real view id and every explicit acknowledgement", async () => {
  for (const missing of [
    "legalName",
    "viewId",
    "generalConfirmed",
    "specifications-0",
    "cancellation-0",
    "specifications-1",
    "cancellation-1",
  ]) {
    const result = await action(
      args({ method: "POST", values: { ...form, [missing]: "" } }),
    );
    expect(result).toHaveProperty("init.status", 400);
  }
  expect(mocks.accept).not.toHaveBeenCalled();
});
it("passes exact posted evidence and actual request headers, never form IP/UA or fake viewed flags", async () => {
  const input = args({
    method: "POST",
    values: {
      ...form,
      profileId: "attacker",
      ipAddress: "fake-ip",
      userAgent: "fake-agent",
      viewed: "true",
    },
  });
  expect(await action(input)).toMatchObject({ status: 302 });
  expect(mocks.accept).toHaveBeenCalledWith(
    "verified-profile",
    input.request,
    {
      requestId: "request",
      piId: "pi-exact",
      documentVersion: 2,
      snapshotHash: hash,
      commandId: form.commandId,
      viewId: "real-view",
      legalName: "Legal Customer",
      acknowledgements: {
        general: { version: "general-v1", confirmed: true },
        madeToOrder: policies.map((policy) => ({
          lineIds: [policy.lineId],
          version: policy.version,
          cancellationVersion: policy.cancellationVersion,
          specificationsConfirmed: true,
          cancellationConfirmed: true,
        })),
      },
    },
    {
      requestId: "actual-request",
      ipAddress: "203.0.113.8",
      userAgent: "actual-browser",
    },
  );
});
it("preserves backend ownership denial and exposes stale/invalid acceptance safely", async () => {
  mocks.accept.mockRejectedValueOnce(
    new Response("Not found", { status: 404 }),
  );
  await expect(action(args({ method: "POST" }))).rejects.toMatchObject({
    status: 404,
  });
  for (const status of [400, 409]) {
    mocks.accept.mockRejectedValueOnce(
      new Response("Invalid PI evidence", { status }),
    );
    expect(await action(args({ method: "POST" }))).toHaveProperty(
      "init.status",
      status,
    );
  }
});

async function show(read = () => page) {
  function Routed() {
    return <Page loaderData={useLoaderData<AcceptancePageData>()} />;
  }
  const load = vi.fn(() => read());
  const router = createMemoryRouter([
    { path: "/", loader: load, element: <Routed /> },
  ]);
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1 });
  return { router, load };
}
function confirmAll() {
  fireEvent.change(screen.getByLabelText("Legal name"), {
    target: { value: "Legal Customer" },
  });
  for (const checkbox of screen.getAllByRole("checkbox"))
    fireEvent.click(checkbox);
}
it("starts every separate acknowledgement unchecked and requires all to enable acceptance", async () => {
  await show();
  expect(screen.getAllByRole("checkbox")).toHaveLength(5);
  for (const checkbox of screen.getAllByRole("checkbox"))
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  expect(
    (
      screen.getByRole("button", {
        name: "Accept this PI",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  confirmAll();
  expect(
    (
      screen.getByRole("button", {
        name: "Accept this PI",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
it("stays disabled without backend view evidence even when all acknowledgements are checked", async () => {
  await show(() => ({
    ...page,
    status: { ...page.status, canAccept: false, viewId: null },
  }));
  confirmAll();
  expect(
    (
      screen.getByRole("button", {
        name: "Accept this PI",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  const view = screen.getByRole("link", { name: "View PI" });
  expect(view.getAttribute("href")).toContain(
    `documentVersion=2&snapshotHash=${hash}&disposition=inline`,
  );
  view.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(view);
  expect(mocks.customerView).not.toHaveBeenCalled();
});
it("refreshes backend view status without checking acknowledgements automatically", async () => {
  let current = {
    ...page,
    status: { ...page.status, canAccept: false, viewId: null as string | null },
  };
  const { load } = await show(() => current);
  current = page;
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.queryByText(
        "Successfully view or download this exact PI before accepting it.",
      ),
    ).toBeNull(),
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Accept this PI",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.focus(window);
  await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(2));
});
it("shows accepted immutable evidence with no editable form or Order action", async () => {
  const acceptance = {
    id: "acceptance-id",
    legalName: "Recorded Legal Name",
    acceptedAt: "2026-09-14T00:00:00.000Z",
    documentVersion: 2,
    snapshotHash: hash,
    acknowledgements: {
      general: { text: "Recorded general acknowledgement" },
      madeToOrder: [],
    },
  } as unknown as NonNullable<AcceptancePageData["status"]["acceptance"]>;
  await show(() => ({
    ...page,
    status: {
      ...page.status,
      status: "PI Accepted",
      canAccept: false,
      acceptance,
    },
  }));
  expect(screen.getByRole("heading", { name: "PI Accepted" })).toBeTruthy();
  expect(screen.getByText("Recorded Legal Name")).toBeTruthy();
  expect(screen.queryByLabelText("Legal name")).toBeNull();
  expect(screen.queryByRole("button", { name: "Accept this PI" })).toBeNull();
  expect(
    screen.getByText(
      "PI acceptance does not confirm payment, create an order, or release production.",
    ),
  ).toBeTruthy();
});
it("removes the acceptance form for expired or superseded PIs", async () => {
  for (const status of [
    { ...page.status, expired: true },
    { ...page.status, current: false },
  ]) {
    await show(() => ({ ...page, status }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "cannot be accepted",
    );
    cleanup();
  }
});
