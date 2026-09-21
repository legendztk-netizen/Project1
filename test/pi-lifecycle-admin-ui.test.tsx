// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import Page, {
  type PiLifecyclePageData,
} from "../app/modules/admin/routes/proforma-invoice-lifecycle";
import {
  PiReplacementForm,
  replacementDeadline,
} from "../app/modules/admin/ui/pi-lifecycle-replacement-form";
vi.mock("../app/modules/admin/ui/admin-navigation", () => ({
  AdminNavigation: () => null,
}));
afterEach(cleanup);

function fixture(): PiLifecyclePageData {
  return {
    requestId: "request",
    commandId: "ff174966-e854-431c-bd14-7d2d967548aa",
    replacement: {
      expectedPi: {
        piId: "pi-old",
        documentVersion: 2,
        snapshotHash: "a".repeat(64),
      },
      expectedHeadVersion: 7,
      expectedAcceptanceId: "acceptance-old",
      nextQuoteRevisionId: "quote-next",
      pdfJobs: [],
      evidence: [
        {
          id: "note-1",
          kind: "note",
          label: "Customer requested sea freight",
          createdAt: "2026-09-14T00:00:00.000Z",
        },
      ],
    },
    issuance: {
      conditionsConfigured: true,
      quoteRevision: { id: "quote-next", hash: "b".repeat(64) },
      pdfJobs: [],
      seller: {
        id: "seller",
        version: 3,
        legalName: "Hangzhou Rongyao Trading Co., Ltd.",
        registeredCountryCode: "CN",
        registeredAddressEn: "1 Testing Road, Hangzhou, China",
      },
      payments: [
        {
          id: "payment",
          version: 4,
          channel: "bank_transfer",
          instructions: "Pay to the selected bank account",
        },
      ],
      current: null,
    },
    history: [
      {
        id: "pi-old",
        requestId: "request",
        quoteRevisionId: "quote-old",
        snapshotHash: "a".repeat(64),
        snapshot: {
          documentNumber: "PI-OLD",
          documentVersion: 2,
          issuedAt: "2026-09-14T00:00:00.000Z",
          validUntil: "2026-09-28T00:00:00.000Z",
          totals: { totalCents: 12000 },
          paymentSelection: { channel: "bank_transfer", instructionVersion: 2 },
        },
        pdf: { sha256: "c".repeat(64) },
        lifecycle: {
          state: "accepted",
          label: "Accepted",
          acceptedAt: "2026-09-14T01:00:00.000Z",
        },
      },
    ],
  } as unknown as PiLifecyclePageData;
}
async function show(basis = fixture(), formOnly = false) {
  const submit = vi.fn(async () => null);
  const router = createMemoryRouter([
    {
      path: "/",
      element: formOnly ? (
        <PiReplacementForm basis={basis} />
      ) : (
        <Page loaderData={basis} />
      ),
      action: submit,
    },
  ]);
  const view = render(<RouterProvider router={router} />);
  return { router, submit, ...view };
}
function completeReview() {
  fireEvent.change(screen.getByLabelText("卖方版本"), {
    target: { value: "seller" },
  });
  fireEvent.change(screen.getByLabelText("付款说明版本"), {
    target: { value: "payment" },
  });
  fireEvent.change(screen.getByLabelText("替换原因"), {
    target: { value: "customer_requested_change" },
  });
  fireEvent.click(screen.getByLabelText("客户要求此次变更"));
  fireEvent.click(screen.getByLabelText("客户提供的信息准确"));
  fireEvent.change(screen.getByLabelText("审核说明"), {
    target: { value: "Customer requested sea freight" },
  });
  fireEvent.click(
    screen.getByLabelText("内部备注：Customer requested sea freight"),
  );
  fireEvent.click(screen.getByLabelText(/我已审核上述确切版本/));
}
it("shows immutable history and enables issuance only after explicit complete review", async () => {
  await show();
  expect(screen.getByRole("heading", { name: "PI 替换与历史" })).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "下载 PDF" }).getAttribute("href"),
  ).toBe("/admin/quotes/request/pi/pi-old/pdf");
  expect(
    (screen.getByRole("button", { name: "签发替换 PI" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  completeReview();
  expect(
    (screen.getByRole("button", { name: "签发替换 PI" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  const form = screen.getByLabelText("卖方版本").closest("form")!;
  const command = JSON.parse(String(new FormData(form).get("command")));
  expect(command).toMatchObject({
    commandId: fixture().commandId,
    quoteRevisionId: "quote-next",
    sellerVersion: 3,
    paymentInstructionVersion: 4,
    replacement: {
      expectedPi: fixture().replacement.expectedPi,
      expectedHeadVersion: 7,
      expectedAcceptanceId: "acceptance-old",
      reason: { evidenceIds: ["note-1"], customerRequested: true },
    },
  });
  fireEvent.change(screen.getByLabelText("审核说明"), {
    target: { value: "Changed reason" },
  });
  expect(
    (screen.getByRole("button", { name: "签发替换 PI" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("captures original tokens across a parent rerender instead of silently adopting a new head", async () => {
  let basis = fixture();
  function Wrapper() {
    return <PiReplacementForm basis={basis} />;
  }
  const router = createMemoryRouter([{ path: "/", element: <Wrapper /> }]);
  const view = render(<RouterProvider router={router} />);
  completeReview();
  basis = {
    ...fixture(),
    replacement: {
      ...fixture().replacement,
      expectedHeadVersion: 99,
      expectedAcceptanceId: "new-acceptance",
    },
  };
  view.rerender(<RouterProvider router={router} />);
  const command = JSON.parse(
    String(
      new FormData(screen.getByLabelText("卖方版本").closest("form")!).get(
        "command",
      ),
    ),
  );
  expect(command.replacement.expectedHeadVersion).toBe(7);
  expect(command.replacement.expectedAcceptanceId).toBe("acceptance-old");
});
it("blocks issuance without a newer quote or while another replacement PDF is pending", async () => {
  for (const kind of ["quote", "job"] as const) {
    const basis = fixture();
    if (kind === "quote") basis.issuance.quoteRevision!.id = "quote-old";
    else
      basis.replacement.pdfJobs = [
        { commandId: "pending", state: "processing", attempts: 1 },
      ];
    await show(basis);
    completeReview();
    expect(
      (screen.getByRole("button", { name: "签发替换 PI" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    cleanup();
  }
});
it("converts explicit Beijing validity to UTC and rejects malformed dates", () => {
  expect(replacementDeadline("2026-10-01T08:30")).toBe(
    "2026-10-01T00:30:00.000Z",
  );
  expect(() => replacementDeadline("2026-02-30T08:30")).toThrow();
});
