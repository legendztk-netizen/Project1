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
} from "../app/modules/after-sales/ui/customer-cancellations";
import { FactoryEvidenceFields } from "../app/modules/after-sales/ui/admin-exceptional";
import {
  readCancellationQuantities,
  readFactoryEvidence,
} from "../app/modules/after-sales/application/parse-after-sales-forms";
import {
  AdminCancellationRequests,
  AdminCancellationDecisionForm,
} from "../app/modules/after-sales/ui/admin-cancellations";

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
                refundLimits: { logisticsCents: 0, taxCents: 0 },
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
    initiations: [],
    remainingCents: 4850,
    onHold: false,
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

it.each([0, 500])(
  "shows the remaining logistics limit of %s cents and rejects a larger amount",
  async (logisticsCents) => {
    render(
      <RouterProvider
        router={createMemoryRouter([
          {
            path: "/",
            element: (
              <AdminCancellationDecisionForm
                request={{
                  ...cancellations.requests[0],
                  refundLimits: { logisticsCents, taxCents: 0 },
                }}
                commandId="limit-test"
                busy={false}
              />
            ),
          },
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "审核并作出取消决定" }));
    const input = screen.getByRole("spinbutton", {
      name: /可退回物流费用/,
    }) as HTMLInputElement;
    expect(input.max).toBe(String(logisticsCents / 100));
    expect(document.body.textContent).toContain(
      `剩余可退物流费用上限：USD ${(logisticsCents / 100).toFixed(2)}`,
    );
    fireEvent.change(input, {
      target: { value: String((logisticsCents + 1) / 100) },
    });
    expect(input.validity.rangeOverflow).toBe(true);
    fireEvent.change(input, {
      target: { value: String(logisticsCents / 100) },
    });
    expect(input.validity.rangeOverflow).toBe(false);
    expect(input.step).toBe("0.01");
    expect(
      (
        screen.getByRole("spinbutton", {
          name: /销售税调整/,
        }) as HTMLInputElement
      ).max,
    ).toBe("0");
  },
);

it.each([
  ["not_started", true],
  ["in_production", false],
  ["completed", false],
  ["unknown", null],
] as const)(
  "records the selected factory status %s without a separate confirmation checkbox",
  (status, precut) => {
    const { container } = render(
      <form>
        <FactoryEvidenceFields files={[]} hasCutHose />
      </form>,
    );
    const select = screen.getByRole("combobox", {
      name: /实际工厂状态/,
    });
    expect(select.getAttribute("required")).not.toBeNull();
    expect(container.querySelector('[name="factoryPrecut"]')).toBeNull();
    fireEvent.change(select, { target: { value: status } });
    const parsed = readFactoryEvidence(
      new FormData(container.querySelector("form")!),
    );
    expect(parsed?.precut).toBe(precut);
    expect(parsed?.status).toBe(
      container.querySelector("select")!.selectedOptions[0].textContent,
    );
  },
);

it("rejects an empty or arbitrary factory status even with the removed checkbox submitted", () => {
  for (const status of ["", "ok"]) {
    const form = new FormData();
    form.set("factoryStatus", status);
    form.set("factoryPrecut", "on");
    expect(() => readFactoryEvidence(form)).toThrow();
  }
});

it("requires fee explanations only for positive amounts and excludes deductions for seller responsibility", () => {
  const { container } = render(
    <RouterProvider
      router={createMemoryRouter([
        {
          path: "/",
          element: (
            <AdminCancellationDecisionForm
              request={{
                ...cancellations.requests[0],
                kind: "exceptional",
                refundLimits: { logisticsCents: 500, taxCents: 500 },
              }}
              commandId="fee-interaction"
              busy={false}
            />
          ),
        },
      ])}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "审核并作出取消决定" }));
  const logistics = screen.getByRole("spinbutton", { name: /可退回物流费用/ });
  const note = screen.getByRole("textbox", { name: /物流核算说明/ });
  expect(note.hasAttribute("required")).toBe(false);
  fireEvent.change(logistics, { target: { value: "1" } });
  expect(note.hasAttribute("required")).toBe(true);
  fireEvent.change(logistics, { target: { value: "0" } });
  expect(note.hasAttribute("required")).toBe(false);
  const responsibility = screen.getByRole("combobox", { name: /责任归属/ });
  fireEvent.change(responsibility, { target: { value: "customer" } });
  fireEvent.change(
    screen.getByRole("spinbutton", { name: /不可退第三方费用/ }),
    { target: { value: "2" } },
  );
  const evidence = screen.getByRole("textbox", { name: /费用凭证说明/ });
  expect(evidence.hasAttribute("required")).toBe(true);
  fireEvent.change(responsibility, { target: { value: "seller" } });
  expect(
    new FormData(container.querySelector("form")!).has("thirdPartyUsd"),
  ).toBe(false);
  expect(evidence.hasAttribute("required")).toBe(false);
  fireEvent.change(responsibility, { target: { value: "customer" } });
  expect(
    new FormData(container.querySelector("form")!).get("thirdPartyUsd"),
  ).toBe("2");
  expect(evidence.hasAttribute("required")).toBe(true);
});

it("updates the quantity summary and resets it when an edited dialog is discarded and reopened", () => {
  render(
    <RouterProvider
      router={createMemoryRouter([
        {
          path: "/",
          element: (
            <AdminCancellationDecisionForm
              request={{
                ...cancellations.requests[0],
                refundLimits: { logisticsCents: 0, taxCents: 0 },
              }}
              commandId="summary-interaction"
              busy={false}
            />
          ),
        },
      ])}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "审核并作出取消决定" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: /批准取消数量/ }), {
    target: { value: "0" },
  });
  expect(screen.getByText("批准 0 / 1，其余拒绝")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃" }));
  fireEvent.click(screen.getByRole("button", { name: "审核并作出取消决定" }));
  expect(screen.getByText("批准 1 / 1，其余拒绝")).toBeTruthy();
});
