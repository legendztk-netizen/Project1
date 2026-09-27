// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it } from "vitest";

import {
  CustomerCaseAction,
  readCaseLines,
} from "../app/modules/after-sales/ui/customer-cases";
import { AdminCases } from "../app/modules/after-sales/ui/admin-cases";
import {
  CustomerReturnsTab,
  customerCaseNextStep,
} from "../app/modules/after-sales/ui/customer-returns";

afterEach(cleanup);

type Cases = Parameters<typeof CustomerCaseAction>[0]["cases"];

const base = {
  lineNumber: 1,
  sku: "STD-A",
  pieceLengthFt: null,
  shipmentName: "Shipment 1",
  deliveredDateEt: "2026-09-10",
  deliveredQuantity: 2,
  available: 2,
};

const cases: Cases = {
  undeliveredShipments: ["Shipment 3"],
  claimable: [
    {
      ...base,
      lineId: "open",
      shipmentId: "s1",
      displayName: "Straight fitting",
      productClass: "standard",
      convenienceCutoffAt: "2026-09-25T03:59:00.000Z",
      convenienceCutoffDateEt: "2026-09-24",
      convenienceOpen: true,
    },
    {
      ...base,
      lineId: "closed",
      shipmentId: "s1",
      displayName: "Old adapter",
      productClass: "standard",
      convenienceCutoffAt: "2026-09-10T03:59:00.000Z",
      convenienceCutoffDateEt: "2026-09-09",
      convenienceOpen: false,
    },
    {
      ...base,
      lineId: "assembly",
      shipmentId: "s1",
      displayName: "Hose assembly",
      productClass: "made_to_order",
      convenienceCutoffAt: null,
      convenienceCutoffDateEt: null,
      convenienceOpen: false,
    },
  ],
  cases: [
    {
      id: "case-1",
      caseNumber: "AS-ORDER-1-1",
      orderId: "order-1",
      reason: "damaged",
      description: "Carton crushed",
      policyVersion: "return-policy-2026-09-27-launch",
      status: "open",
      version: 2,
      createdAt: "2026-09-12T12:00:00.000Z",
      updatedAt: "2026-09-12T12:00:00.000Z",
      lines: [
        {
          lineId: "open",
          lineNumber: 1,
          displayName: "Straight fitting",
          sku: "STD-A",
          pieceLengthFt: null,
          shipmentId: "s1",
          shipmentName: "Shipment 1",
          physicalQuantity: 1,
          productClass: "standard",
          deliveredDateEt: "2026-09-10",
          convenienceCutoffAt: null,
        },
      ],
      events: [
        {
          id: "case-event:1",
          body: "Return not authorized. Reason: the carton photos show no damage.",
          createdAt: "2026-09-12T13:00:00.000Z",
          fileIds: ["file-1"],
        },
      ],
      files: [
        {
          id: "file-1",
          filename: "carton-check.pdf",
          uploaderRole: "admin",
          visibility: "shared",
          shareReason: "随不予授权说明附给客户",
          createdAt: "2026-09-12T13:00:00.000Z",
        },
      ],
    },
  ],
};

it("explains per-Shipment return windows and made-to-order limits in the report form", async () => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <CustomerCaseAction cases={cases} commandId="command-1" />,
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Request Return or Report a Problem",
    }),
  );
  const text = document.body.textContent ?? "";
  expect(text).toContain(
    "Convenience return open until 11:59 PM ET on Sep 24, 2026",
  );
  expect(text).toContain(
    "Convenience return window closed; problems can still be reported.",
  );
  expect(text).toContain("Made to order: problems can be reported");
  expect(text).toContain("does not authorize a return or approve a refund");
  const form = screen.getByRole("button", { name: "Submit" }).closest("form")!;
  expect(form.getAttribute("enctype")).toBe("multipart/form-data");
  const data = new FormData();
  data.set("caseQty:open:s1", "1");
  data.set("caseQty:closed:s1", "0");
  expect(readCaseLines(data)).toEqual([
    { lineId: "open", shipmentId: "s1", physicalQuantity: 1 },
  ]);
});

it("shows the operation record without a reply form and links the conversation to Messages", async () => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <CustomerReturnsTab
              cases={cases}
              ras={[]}
              receipts={[]}
              orderId="order-1"
              requestId="request-1"
              commandId="command-2"
              busy={false}
            />
            <AdminCases
              cases={[
                {
                  ...cases.cases[0],
                  events: cases.cases[0].events.map((event) => ({
                    ...event,
                    authorId: "owner",
                  })),
                },
              ]}
              orderId="order-1"
              requestId="request-1"
              files={[
                {
                  id: "file-1",
                  filename: "carton-check.pdf",
                  uploaderRole: "admin",
                  visibility: "shared",
                  shareReason: "随不予授权说明附给客户",
                  createdAt: "2026-09-12T13:00:00.000Z",
                  scopeKind: "case",
                  scopeId: "case-1",
                  contentType: "application/pdf",
                  byteSize: 10,
                  sharedAt: "2026-09-12T13:00:00.000Z",
                },
              ]}
              commandId="command-3"
              busy={false}
            />
          </>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByText(/Case AS-ORDER-1-1/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Send reply" })).toBeNull();
  expect(document.querySelector("textarea")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Message us about this case" })
      .getAttribute("href"),
  ).toBe("/account/messages/request-1?case=case-1#latest");
  expect(
    screen.getByRole("link", { name: "客户对话" }).getAttribute("href"),
  ).toBe("/admin/messages/request-1?case=case-1#latest");
  // The attachment is shown on the event it was sent with, for both sides,
  // and in the Admin evidence list.
  expect(
    screen
      .getAllByRole("link", { name: "carton-check.pdf" })
      .map((link) => link.getAttribute("href")),
  ).toEqual([
    "/account/orders/order-1/after-sales/files/file-1",
    "/admin/orders/order-1/after-sales/files/file-1",
    "/admin/orders/order-1/after-sales/files/file-1",
  ]);
  const text = document.body.textContent ?? "";
  expect(text).toContain("Shipment 3 shipped but delivery isn't recorded yet");
  expect(text).toContain("Return not authorized");
  expect(text).toContain("运输损坏");
});

it("tells the customer the next step for each Case stage", () => {
  const ra = {
    id: "ra-1",
    expired: false,
    arrivalDeadlineDateEt: "2026-10-27",
  };
  expect(customerCaseNextStep({ status: "open" }, [], [])).toContain(
    "reviewing your report",
  );
  expect(customerCaseNextStep({ status: "open" }, [ra], [])).toContain(
    "arrive by 11:59 PM ET on Oct 27, 2026",
  );
  const receipt = {
    raId: "ra-1",
    timeliness: "timely" as const,
    lateReviewed: false,
    inspectionDeadlineDateEt: "2026-10-05",
    decision: null,
  };
  expect(customerCaseNextStep({ status: "open" }, [ra], [receipt])).toContain(
    "decide by Oct 5, 2026",
  );
  const refund = {
    id: "refund-1",
    status: "approved",
    refundCents: 24000,
    initiatedCents: 0,
    deadlineDateEt: "2026-10-09",
  };
  const decided = {
    ...receipt,
    decision: { refunds: [refund] },
  } as unknown as Parameters<typeof customerCaseNextStep>[2][number];
  expect(customerCaseNextStep({ status: "open" }, [ra], [decided])).toBe(
    "Your refund of USD 240.00 is approved. We'll initiate it by Oct 9, 2026; your bank or PayPal may take longer to post it.",
  );
  expect(customerCaseNextStep({ status: "closed" }, [], [])).toBe(
    "This case is closed.",
  );
});

it("round-trips Spec 6 Shipment ids that contain colons in every scoped form", async () => {
  const { scopedField } =
    await import("../app/modules/after-sales/ui/scoped-fields");
  const { readCancellationQuantities } =
    await import("../app/modules/after-sales/ui/customer-cancellations");
  const { readRaLines } =
    await import("../app/modules/after-sales/ui/return-authorizations");
  const { readInspectionItems, readReceiptLines, readRevisionItems } =
    await import("../app/modules/after-sales/ui/return-inspection");
  const { readCancellationDecisions } =
    await import("../app/modules/after-sales/ui/admin-cancellations");
  const lineId = "line:with:colons";
  const shipmentId = "shipment:order-123:together";
  const data = new FormData();
  data.set(scopedField("caseQty", lineId, shipmentId), "2");
  data.set(scopedField("cancelQty", lineId, shipmentId), "1");
  data.set(scopedField("approve", lineId, shipmentId), "1");
  data.set(scopedField("raQty", lineId, shipmentId), "2");
  data.set(scopedField("receiveQty", lineId, shipmentId), "1");
  data.set(scopedField("reviseApprove", lineId, shipmentId), "1");
  data.set(scopedField("inspectApprove", lineId, shipmentId), "1");
  data.set(scopedField("inspect-finish", lineId, shipmentId), "Clean");
  const expected = { lineId, shipmentId };
  expect(readCaseLines(data)).toEqual([{ ...expected, physicalQuantity: 2 }]);
  expect(readCancellationQuantities(data)).toEqual([
    { ...expected, physicalQuantity: 1 },
  ]);
  expect(readCancellationDecisions(data)).toEqual([
    { ...expected, approvedQuantity: 1 },
  ]);
  expect(readRaLines(data)).toEqual([{ ...expected, physicalQuantity: 2 }]);
  expect(readReceiptLines(data)).toEqual([
    { ...expected, physicalQuantity: 1 },
  ]);
  expect(readRevisionItems(data)).toEqual([
    { ...expected, approvedQuantity: 1 },
  ]);
  expect(readInspectionItems(data)[0]).toMatchObject({
    ...expected,
    approvedQuantity: 1,
    conditions: { finish: "Clean" },
  });
});

it("hides the unused-item return reason when no delivered item qualifies", async () => {
  const renderWith = async (claimable: Cases["claimable"]) => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <CustomerCaseAction
              cases={{ ...cases, claimable }}
              commandId="command-9"
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Request Return or Report a Problem",
      }),
    );
  };
  await renderWith(cases.claimable.filter((item) => item.lineId !== "open"));
  expect(
    screen.queryByRole("radio", {
      name: "Return an unused item (change of mind or wrong selection)",
    }),
  ).toBeNull();
  expect(
    (
      screen.getByRole("radio", {
        name: "Defective or not as specified",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(document.body.textContent).toContain(
    "Returning an unused item isn't available for these items",
  );
  cleanup();
  await renderWith(cases.claimable);
  expect(
    screen.getByRole("radio", {
      name: "Return an unused item (change of mind or wrong selection)",
    }),
  ).toBeTruthy();
});
