// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
} from "react-router";
import { afterEach, expect, it } from "vitest";

import {
  CustomerCancellationAction,
  CustomerCancellationRequests,
  readCancellationQuantities,
} from "../app/modules/after-sales/ui/customer-cancellations";
import { AdminCancellationRequests } from "../app/modules/after-sales/ui/admin-cancellations";

afterEach(cleanup);

type Cancellations = Parameters<
  typeof CustomerCancellationAction
>[0]["cancellations"];

const cancellations: Cancellations = {
  supportOnlyLines: [],
  conversationPath: "/account/quotes/request-1/conversation",
  eligible: [
    {
      lineId: "line-a",
      shipmentId: "shipment-1",
      shipmentVersion: 1,
      available: 2,
      displayName: "Straight fitting",
      sku: "STD-A",
      shipmentName: "Shipment 1",
    },
  ],
  requests: [
    {
      id: "request-1",
      orderId: "order-1",
      kind: "standard",
      origin: "customer",
      status: "pending_review",
      version: 1,
      reason: "Ordered too many",
      createdAt: "2026-09-24T12:00:00.000Z",
      updatedAt: "2026-09-24T12:00:00.000Z",
      handoffConflict: false,
      resolution: null,
      lines: [
        {
          lineId: "line-a",
          lineNumber: 1,
          displayName: "Straight fitting",
          sku: "STD-A",
          productClass: "standard",
          pieceLengthFt: null,
          shipmentId: "shipment-1",
          shipmentName: "Shipment 1",
          physicalQuantity: 1,
          holdActive: true,
          handedOff: false,
        },
      ],
      events: [{ kind: "submitted", occurredAt: "2026-09-24T12:00:00.000Z" }],
    },
  ],
};

function Harness() {
  const actionData = useActionData() as { error?: string } | undefined;
  return (
    <>
      <CustomerCancellationAction
        cancellations={cancellations}
        commandId="command-1"
        actionData={actionData}
      />
      <CustomerCancellationRequests
        cancellations={cancellations}
        commandId="command-2"
        busy={false}
      />
    </>
  );
}

it("keeps entered quantities and reason visible after a rejected submission", async () => {
  let submitted: FormData | null = null;
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Harness />,
        action: async ({ request }) => {
          submitted = await request.formData();
          return { error: "These quantities changed. Refresh and review." };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Request cancellation" }),
  );
  const quantity = screen.getByLabelText(
    "Quantity of Straight fitting to cancel",
  ) as HTMLInputElement;
  expect(quantity.max).toBe("2");
  fireEvent.change(quantity, { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "Project cancelled" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Submit cancellation request" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "These quantities changed",
    ),
  );
  expect(
    (
      screen.getByLabelText(
        "Quantity of Straight fitting to cancel",
      ) as HTMLInputElement
    ).value,
  ).toBe("2");
  expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe(
    "Project cancelled",
  );
  expect(readCancellationQuantities(submitted!)).toEqual([
    { lineId: "line-a", shipmentId: "shipment-1", physicalQuantity: 2 },
  ]);
});

it("shows pending requests with a withdraw action and hides the action when nothing is eligible", async () => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <CustomerCancellationAction
              cancellations={{ ...cancellations, eligible: [] }}
              commandId="command-1"
            />
            <CustomerCancellationRequests
              cancellations={cancellations}
              commandId="command-2"
              busy={false}
            />
          </>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  expect(
    await screen.findByRole("button", { name: "Withdraw request" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Request cancellation" })).toBe(
    null,
  );
  expect(document.body.textContent).toContain("Straight fitting × 1");
});

it("labels Admin cancellation holds and handoff conflicts in Chinese", async () => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <AdminCancellationRequests
            requests={[
              {
                ...cancellations.requests[0],
                handoffConflict: true,
                events: [
                  {
                    kind: "submitted",
                    occurredAt: "2026-09-24T12:00:00.000Z",
                    actorId: "buyer",
                    details: {},
                  },
                ],
              },
            ]}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByText("交接冲突")).toBeTruthy();
  expect(document.body.textContent).toContain("待审核（数量已锁定）");
  expect(document.body.textContent).toContain("锁定中");
});

it("shows the gross-to-net breakdown and asks the customer to confirm a deduction", async () => {
  const refund = {
    id: "refund-1",
    sourceKind: "cancellation" as const,
    sourceId: "resolution-1",
    responsibility: "customer" as const,
    status: "awaiting_customer_confirmation" as const,
    version: 1,
    merchandiseCents: 5000,
    logisticsCents: 0,
    sellerLogisticsCents: 0,
    taxCents: 0,
    serviceFeeCents: 0,
    restockingFeeCents: 0,
    thirdPartyCostCents: 150,
    thirdPartyCostEvidence: "Bank return fee notice",
    grossCents: 5000,
    refundCents: 4850,
    initiatedCents: 0,
    remainingCents: 4850,
    approvedAt: null,
    deadlineDateEt: null,
    deadlineAt: null,
    previousAuthorizationId: null,
    createdAt: "2026-09-24T12:00:00.000Z",
  };
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <CustomerCancellationRequests
            cancellations={{
              ...cancellations,
              eligible: [],
              requests: [
                {
                  ...cancellations.requests[0],
                  status: "resolved",
                  resolution: {
                    id: "resolution-1",
                    outcome: "approved",
                    customerReason: "Cancelled before packing.",
                    decidedAt: "2026-09-24T12:00:00.000Z",
                    lines: [
                      {
                        lineId: "line-a",
                        shipmentId: "shipment-1",
                        displayName: "Straight fitting",
                        requestedQuantity: 1,
                        approvedQuantity: 1,
                        declinedQuantity: 0,
                        merchandiseCents: 5000,
                      },
                    ],
                    financial: {
                      merchandiseCents: 5000,
                      logisticsCents: 0,
                      logisticsNote: null,
                      taxCents: 0,
                      taxNote: null,
                      serviceFeeCents: 0,
                      serviceFeeNote: null,
                      thirdPartyCostCents: 150,
                      thirdPartyCostEvidence: "Bank return fee notice",
                      grossCents: 5000,
                      refundCents: 4850,
                    },
                    refunds: [refund],
                  },
                },
              ],
            }}
            commandId="command-3"
            busy={false}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  expect(
    await screen.findByRole("button", { name: "Confirm refund amount" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Dispute this amount" }),
  ).toBeTruthy();
  const text = document.body.textContent ?? "";
  expect(text).toContain("Your confirmation is needed");
  expect(text).toContain("USD 50.00");
  expect(text).toContain("-USD 1.50");
  expect(text).toContain("USD 48.50");
  expect(text).not.toContain("Refund initiated");
  expect(screen.queryByRole("button", { name: "Withdraw request" })).toBe(null);
});
