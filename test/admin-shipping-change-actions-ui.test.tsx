// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AdminOrderShippingChanges } from "../app/modules/shipment/ui/admin-order-shipping-changes";
afterEach(cleanup);
type Props = Parameters<typeof AdminOrderShippingChanges>[0];
function setup() {
  const action = vi.fn(() => null);
  const props: Props = {
    changes: [
      {
        id: "change-1",
        kind: "shipping_plan",
        status: "pending_review",
        version: 1,
        requested: { note: "Please split the delivery" },
        currentProposalId: null,
        createdAt: "2026-09-28T00:00:00Z",
        updatedAt: "2026-09-28T00:00:00Z",
        shipments: [
          {
            shipmentId: "shipment-internal",
            versionAtRequest: 1,
            quantities: [{ lineId: "line-1", physicalQuantity: 2 }],
          },
        ],
        proposals: [],
      },
    ],
    shipments: [
      {
        id: "shipment-internal",
        displayName: "Ship together",
        status: "planned",
        version: 1,
        destination: {
          recipientName: "Buyer",
          addressLine1: "1 Main St",
          addressLine2: "",
          city: "Houston",
          stateProvince: "TX",
          postalCode: "77001",
          countryCode: "US",
          recipientPhone: "",
          recipientEmail: "",
        },
        transportMethod: "Air",
        incoterm: "DDP",
        namedPlace: "Houston",
        carrierName: null,
        serviceName: null,
        destinationTaxTreatment: null,
        allocations: [
          { lineId: "line-1", displayName: "Fitting", physicalQuantity: 2 },
        ],
        readyDate: null,
      },
    ],
    milestones: [],
    commandId: "test-command",
    busy: false,
  };
  render(
    <RouterProvider
      router={createMemoryRouter([
        {
          path: "/",
          element: <AdminOrderShippingChanges {...props} />,
          action,
        },
      ])}
    />,
  );
  return action;
}
it("opens approval and rejection forms without submitting a decision and uses readable shipment names", () => {
  const action = setup();
  expect(document.body.textContent).not.toContain("shipment-internal");
  fireEvent.click(screen.getByRole("button", { name: "同意申请" }));
  expect(screen.getByRole("heading", { name: "审核并提出变更" })).toBeTruthy();
  expect(new FormData(document.querySelector("form")!).get("intent")).toBe(
    "shipping-change-propose",
  );
  expect(screen.getByLabelText("收件人").getAttribute("value")).toBe("Buyer");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "拒绝申请" }));
  expect(screen.getByRole("heading", { name: "拒绝变更申请" })).toBeTruthy();
  expect(new FormData(document.querySelector("form")!).get("intent")).toBe(
    "shipping-change-decline",
  );
  expect(screen.getByLabelText("拒绝原因").hasAttribute("required")).toBe(true);
  expect(action).not.toHaveBeenCalled();
});
it("discards a draft split selection when reopening the approval dialog", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "同意申请" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "新增分批发货批次" }));
  expect(document.body.textContent).toContain("新增批次分配");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃" }));
  fireEvent.click(screen.getByRole("button", { name: "同意申请" }));
  expect(document.body.textContent).not.toContain("新增批次分配");
});
