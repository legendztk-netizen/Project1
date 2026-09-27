// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it } from "vitest";

import {
  CustomerCaseAction,
  CustomerCases,
  readCaseLines,
} from "../app/modules/after-sales/ui/customer-cases";
import { AdminCases } from "../app/modules/after-sales/ui/admin-cases";

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
      messages: [
        {
          id: "m1",
          authorRole: "admin",
          visibility: "customer",
          kind: "message",
          body: "We are reviewing your photos.",
          createdAt: "2026-09-12T13:00:00.000Z",
        },
      ],
      files: [],
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

it("renders the Case thread, reply form and undelivered guidance for customers and Admin", async () => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <CustomerCases
              cases={cases}
              orderId="order-1"
              commandId="command-2"
              busy={false}
            />
            <AdminCases
              cases={[
                {
                  ...cases.cases[0],
                  messages: [
                    ...cases.cases[0].messages.map((message) => ({
                      ...message,
                      authorId: "owner",
                    })),
                    {
                      id: "m2",
                      authorRole: "admin",
                      authorId: "owner",
                      visibility: "internal",
                      kind: "message",
                      body: "Check supplier lot",
                      createdAt: "2026-09-12T14:00:00.000Z",
                    },
                  ],
                } as Parameters<typeof AdminCases>[0]["cases"][number],
              ]}
              orderId="order-1"
              files={[]}
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
  expect(screen.getByRole("button", { name: "Send reply" })).toBeTruthy();
  const text = document.body.textContent ?? "";
  expect(text).toContain("Shipment 3 shipped but delivery isn't recorded yet");
  expect(text).toContain("（内部备注）");
  expect(text).toContain("运输损坏");
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
