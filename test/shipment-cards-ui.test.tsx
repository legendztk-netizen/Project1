// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AdminShipmentCards } from "../app/modules/shipment/ui/admin-shipment-cards";
import {
  CustomerShipmentCards,
  customerOrderProgress,
} from "../app/modules/shipment/ui/customer-shipment-cards";
import {
  adminShipmentProgressLabel,
  formatPhysicalQuantity,
} from "../app/modules/shipment/ui/shipment-display";

afterEach(cleanup);

type CustomerProps = Parameters<typeof CustomerShipmentCards>[0];
type AdminProps = Parameters<typeof AdminShipmentCards>[0];

const destination = {
  recipientName: "Pat Buyer",
  addressLine1: "1 Main St",
  addressLine2: "",
  city: "Houston",
  stateProvince: "TX",
  postalCode: "77001",
  countryCode: "US",
};

function shipment(id: string, sequenceNumber: number, extra = {}) {
  return {
    id,
    sequenceNumber,
    displayName: `Batch ${sequenceNumber}`,
    groupKey: `group-${sequenceNumber}`,
    status: "planned",
    held: false,
    version: 1,
    incoterm: "DDP",
    namedPlace: "Houston",
    transportMethod: "Sea",
    destination,
    freightCents: 0,
    insuranceCents: 0,
    dutiesImportCents: 0,
    quotedAllocations: [{ lineId: "line-1" }],
    allocations: [
      {
        lineId: "line-1",
        displayName: "601R1 Hydraulic Hose -4",
        sku: "601R1_002",
        lineKind: "length_based_hose",
        physicalQuantity: 1,
        unit: "pieces",
        lengthPerPiece: { value: 50, unit: "ft" },
      },
    ],
    ...extra,
  };
}

function milestone(shipmentId: string, status: string, extra = {}) {
  return {
    shipmentId,
    displayName: shipmentId,
    status,
    version: 1,
    events: [],
    tracking: [],
    ...extra,
  };
}

describe("customer shipment cards", () => {
  it("does not show changed goods as ready while re-verification is pending", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CustomerShipmentCards
          plan={
            {
              orderId: "order-1",
              status: "ready",
              shipments: [shipment("split-1", 1, { status: "ready_to_ship" })],
            } as unknown as CustomerProps["plan"]
          }
          milestones={
            [
              milestone("split-1", "ready_to_ship", {
                releaseReviewPending: true,
                events: [
                  {
                    kind: "ready_to_ship",
                    actualDate: null,
                    actualAt: null,
                    recordedAt: "2026-09-24T00:00:00Z",
                  },
                ],
              }),
            ] as unknown as CustomerProps["milestones"]
          }
          schedules={[]}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Shipment readiness is being rechecked");
    expect(html).toMatch(/data-state="current"[^>]*>.*?Ready to Ship/);
    expect(html).not.toContain("Tracking follows after carrier handoff");
    expect(html).toContain("View date and milestone history");
    expect(html).toContain("1 piece · 50 ft each");
  });

  it("summarizes split shipments without implying the whole order shipped", () => {
    const progress = customerOrderProgress(
      { status: "ready", shipments: [] } as unknown as CustomerProps["plan"],
      [
        milestone("a", "shipped"),
        milestone("b", "planned"),
      ] as unknown as CustomerProps["milestones"],
    );
    expect(progress.headline).toBe("Partially shipped");
    expect(progress.summary).toBe("1 of 2 shipments shipped · 0 delivered");
  });
});

describe("admin shipment cards", () => {
  function renderAdmin(overrides: {
    shipments: ReturnType<typeof shipment>[];
    milestones: ReturnType<typeof milestone>[];
  }) {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <AdminShipmentCards
              plan={
                {
                  orderId: "order-1",
                  status: "ready",
                  version: 1,
                  paymentHeld: false,
                  shipments: overrides.shipments,
                } as unknown as AdminProps["plan"]
              }
              schedules={[]}
              milestones={
                overrides.milestones as unknown as AdminProps["milestones"]
              }
              milestoneCommands={{}}
              trackingCommands={{}}
              scheduleCommandIds={{}}
              planCommandId="command-1"
              onReviewChanges={() => {}}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
  }

  it("puts the next status action on each shipment card", async () => {
    renderAdmin({
      shipments: [
        shipment("s-1", 1),
        shipment("s-2", 2, { status: "shipped" }),
      ],
      milestones: [milestone("s-1", "planned"), milestone("s-2", "shipped")],
    });
    expect(
      await screen.findByRole("button", { name: "核实备妥" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "记录送达" })).toBeTruthy();
    expect(screen.getAllByText("1 根 · 每根 50 ft")).toHaveLength(2);
  });

  it("disables release actions for a held shipment and explains why", async () => {
    renderAdmin({
      shipments: [shipment("s-1", 1, { held: true })],
      milestones: [milestone("s-1", "planned")],
    });
    const button = await screen.findByRole("button", { name: "核实备妥" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("当前有付款或数量限制，不能新放行该批次。"),
    ).toBeTruthy();
    expect(screen.getByText("暂缓放行")).toBeTruthy();
  });
});

describe("shipment display helpers", () => {
  it("labels admin order progress from shipment milestones", () => {
    expect(adminShipmentProgressLabel([])).toBe("订单已确认");
    expect(adminShipmentProgressLabel([{ status: "planned" }])).toBe("待备妥");
    expect(
      adminShipmentProgressLabel([
        { status: "shipped" },
        { status: "planned" },
      ]),
    ).toBe("已发货 1/2 批");
    expect(
      adminShipmentProgressLabel([
        { status: "delivered" },
        { status: "delivered" },
      ]),
    ).toBe("已全部送达");
  });

  it("formats cut hose pieces separately from pricing footage", () => {
    const allocation = {
      physicalQuantity: 3,
      unit: "pieces",
      lengthPerPiece: { value: 20, unit: "in" },
    };
    expect(formatPhysicalQuantity(allocation, "zh")).toBe("3 根 · 每根 20 in");
    expect(formatPhysicalQuantity(allocation, "en")).toBe(
      "3 pieces · 20 in each",
    );
    expect(
      formatPhysicalQuantity({ physicalQuantity: 2, unit: "each" }, "en"),
    ).toBe("2 each");
  });
});
