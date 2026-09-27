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
