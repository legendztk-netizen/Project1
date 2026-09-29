import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { CustomerOrderList } from "../app/modules/customer-identity/ui/customer-order-list";

type Orders = Parameters<typeof CustomerOrderList>[0]["orders"];

function order(overrides: Partial<Orders["records"][number]>) {
  return {
    id: "order-1",
    orderNumber: "ORD-1",
    status: "Order Confirmed",
    confirmedAt: "2026-09-25T03:40:04.000Z",
    totalCents: 24000,
    shipmentCount: 2,
    shippedCount: 1,
    deliveredCount: 0,
    shipmentPlanStatus: "ready",
    stage: "shipped",
    lineCount: 2,
    nextReadyDate: null,
    lastDeliveredDate: null,
    firstLine: {
      displayName: "601R2 Hydraulic Hose Assembly",
      sku: "601R2_002",
      imageUrl: null,
      hoseMediaKey: null,
    },
    ...overrides,
  } as Orders["records"][number];
}

function render(records: Orders["records"], selected = "all" as const) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <CustomerOrderList
        selected={selected}
        orders={{
          records,
          nextCursor: null,
          counts: { all: 3, processing: 1, ready: 0, shipped: 1, delivered: 1 },
        }}
      />
    </MemoryRouter>,
  );
}

it("shows status tabs with counts and a summary card per order", () => {
  const html = render([order({})]);
  expect(html).toContain('aria-current="page"');
  expect(html).toMatch(/All orders.*?>3</);
  expect(html).toContain('href="/account?view=orders&amp;status=shipped"');
  expect(html).toContain("Partially shipped");
  expect(html).toContain("601R2 Hydraulic Hose Assembly + 1 more item");
  expect(html).toContain("1 of 2 shipments shipped");
  expect(html).toContain("USD 240.00");
  expect(html).toContain('href="/account/orders/order-1"');
});

it("prioritizes payment review and shows the next ready date", () => {
  expect(
    render([order({ status: "Payment Review Hold", stage: "processing" })]),
  ).toContain("Payment under review");
  expect(
    render([
      order({
        stage: "processing",
        shippedCount: 0,
        nextReadyDate: "2026-10-05",
      }),
    ]),
  ).toContain("Estimated ready to ship Oct 5, 2026");
});

it("explains an empty status tab", () => {
  expect(render([], "delivered" as never)).toContain(
    "No orders are delivered right now.",
  );
});
