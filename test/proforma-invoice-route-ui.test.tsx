import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactNode } from "react";
import AdminPi from "../app/modules/admin/routes/proforma-invoice";
import CustomerPi from "../app/modules/customer-identity/routes/proforma-invoice";
import type { PiRecord, PiReadiness } from "../workers/proforma-invoice";
import type { PiAcceptanceStatus } from "../workers/pi-acceptance";

vi.mock("../app/modules/customer-identity/ui/account-workspace", () => ({
  AccountWorkspace: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../app/modules/admin/ui/admin-navigation", () => ({
  AdminNavigation: () => <nav>管理后台</nav>,
}));
function render(element: ReactNode) {
  return renderToStaticMarkup(
    <RouterProvider router={createMemoryRouter([{ path: "/", element }])} />,
  );
}
const invoice = {
  id: "fixed-pi",
  snapshotHash: "a".repeat(64),
  snapshot: {
    documentNumber: "PI-EXACT",
    documentVersion: 1,
    quoteRevision: { number: 2 },
    issuedAt: "2026-09-14T00:00:00.000Z",
    validUntil: "2026-09-28T00:00:00.000Z",
    totals: { totalCents: 12345 },
    seller: {
      legalName: "Hangzhou Rongyao Trading Co., Ltd.",
      registeredAddressEn: "Hangzhou, China",
    },
  },
  paymentInstructions: {
    channel: "bank_transfer",
    version: 4,
    instructions: "Selected bank details\n<script>not executable</script>",
  },
} as PiRecord;
const currentStatus: PiAcceptanceStatus = {
  piId: invoice.id,
  documentVersion: 1,
  snapshotHash: invoice.snapshotHash,
  current: true,
  expired: false,
  status: "PI Ready",
  canAccept: false,
  viewId: null,
  acceptance: null,
};

it("shows the exact protected PI links, USD total and selected instructions in English", () => {
  const html = render(
    <CustomerPi
      loaderData={{ requestId: "request", invoice, status: currentStatus }}
    />,
  );
  expect(html).toContain("USD 123.45");
  expect(html).toContain(
    "/account/quotes/request/pi/fixed-pi/pdf?disposition=inline",
  );
  expect(html).toContain("/account/quotes/request/pi/fixed-pi/pdf");
  expect(html).toContain("Selected bank details");
  expect(html).toContain("&lt;script&gt;not executable&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Sep 13, 2026");
  expect(html).toContain("20:00:00");
  expect(html).toContain("flex-wrap:wrap");
});
it("shows actionable unavailable-instructions and unissued states without payment fallback", () => {
  const html = render(
    <CustomerPi
      loaderData={{
        requestId: "request",
        invoice: { ...invoice, paymentInstructions: null },
        status: currentStatus,
      }}
    />,
  );
  expect(html).toContain("Contact Support before sending payment");
  expect(html).not.toContain("Selected bank details");
  expect(
    render(<CustomerPi loaderData={{ requestId: "request", invoice: null }} />),
  ).toContain("No proforma invoice has been issued");
});
it("shows Chinese Admin readiness with no default payment selection and exact quote hash", () => {
  const readiness = {
    pdfJobs: [],
    quoteRevision: { id: "revision", hash: "immutable-hash" },
    seller: null,
    payments: [],
    conditionsConfigured: false,
    current: null,
  } satisfies PiReadiness;
  const html = render(
    <AdminPi
      loaderData={{
        requestId: "request",
        readiness,
        paymentHistory: [],
        commandId: "command",
      }}
    />,
  );
  expect(html).toContain("形式发票 PI");
  expect(html).toContain('name="quoteRevisionHash" value="immutable-hash"');
  expect(html).toContain("中国注册英文地址");
  expect(html).toContain("无有效付款说明");
  expect(html).toContain("disabled");
  expect(html).toContain("14 天");
});
it("shows issued Admin PDF and Beijing time without another issuance form", () => {
  const readiness = {
    pdfJobs: [],
    quoteRevision: null,
    seller: null,
    payments: [],
    conditionsConfigured: true,
    current: invoice,
  } satisfies PiReadiness;
  const html = render(
    <AdminPi
      loaderData={{
        requestId: "request",
        readiness,
        paymentHistory: [],
        commandId: "command",
      }}
    />,
  );
  expect(html).toContain("/admin/quotes/request/pi/fixed-pi/pdf");
  expect(html).toContain("08:00:00");
  expect(html).not.toContain('name="intent"');
});

it("keeps the retry command after loader revalidation but uses the new ID after conflict", () => {
  const readiness = {
    pdfJobs: [],
    quoteRevision: null,
    seller: null,
    payments: [],
    conditionsConfigured: true,
    current: null,
  } satisfies PiReadiness;
  const loaderData = {
    requestId: "request",
    readiness,
    paymentHistory: [],
    commandId: "fresh-loader-command",
  };
  const retry = render(
    <AdminPi
      loaderData={loaderData}
      actionData={{ error: "Retry", commandId: "submitted-command" }}
    />,
  );
  expect(retry).toContain('name="commandId" value="submitted-command"');
  const conflict = render(
    <AdminPi loaderData={loaderData} actionData={{ error: "Conflict" }} />,
  );
  expect(conflict).toContain('name="commandId" value="fresh-loader-command"');
});

it("shows a durable failed PDF job with an explicit retry command", () => {
  const html = render(
    <AdminPi
      loaderData={{
        requestId: "request",
        commandId: "new-command",
        paymentHistory: [],
        readiness: {
          pdfJobs: [
            { commandId: "saved-command", state: "failed", attempts: 5 },
          ],
          quoteRevision: null,
          seller: null,
          payments: [],
          conditionsConfigured: true,
          current: null,
        },
      }}
    />,
  );
  expect(html).toContain("PDF 生成失败");
  expect(html).toContain('value="retry-pdf"');
  expect(html).toContain('value="saved-command"');
});
