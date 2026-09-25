import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CustomerShipmentMilestones } from "../app/modules/shipment/ui/customer-shipment-milestones";

it("does not show changed goods as ready while re-verification is pending", () => {
  const html = renderToStaticMarkup(
    <CustomerShipmentMilestones
      milestones={[
        {
          shipmentId: "split-1",
          displayName: "Shipment 1",
          status: "ready_to_ship",
          releaseReviewPending: true,
          events: [
            {
              kind: "ready_to_ship",
              actualDate: null,
              actualAt: null,
              recordedAt: "2026-09-24T00:00:00Z",
            },
          ],
          tracking: [],
        },
      ]}
      heldShipmentIds={[]}
    />,
  );
  expect(html).toContain("Shipment readiness is being rechecked");
  expect(html).toMatch(/data-complete="false">Ready to Ship/);
  expect(html).not.toContain("Tracking follows after carrier handoff");
  expect(html).toContain("View milestone history");
});
