// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it } from "vitest";
import { AdminAfterSalesTabs } from "../app/modules/after-sales/ui/admin-after-sales-tabs";

afterEach(cleanup);
function setup(url: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/order",
        element: (
          <AdminAfterSalesTabs
            counts={{ cases: 0, refunds: 2, cancellations: 1 }}
            panels={{
              cases: <p>Case content</p>,
              refunds: <p>Refund content</p>,
              cancellations: <p>Cancellation content</p>,
            }}
          />
        ),
      },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
it("opens a deep-linked child panel and preserves the list return link across switching and back navigation", async () => {
  const router = setup(
    "/order?tab=after-sales&afterSalesTab=cancellations&returnTo=%2Fadmin%2Forders%3Fpage%3D2",
  );
  expect(screen.getByText("Cancellation content")).toBeTruthy();
  expect(screen.queryByText("Case content")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: /退款/ }));
  await screen.findByText("Refund content");
  expect(screen.queryByText("Cancellation content")).toBeNull();
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get("afterSalesTab")).toBe("refunds");
  expect(params.get("returnTo")).toBe("/admin/orders?page=2");
  await router.navigate(-1);
  await screen.findByText("Cancellation content");
});
it("defaults invalid values to cases and supports keyboard tab navigation", async () => {
  const router = setup("/order?tab=after-sales&afterSalesTab=unknown");
  const cases = screen.getByRole("tab", { name: /售后案件/ });
  expect(cases.getAttribute("aria-selected")).toBe("true");
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  fireEvent.keyDown(cases, { key: "End" });
  await waitFor(() =>
    expect(
      new URLSearchParams(router.state.location.search).get("afterSalesTab"),
    ).toBe("cancellations"),
  );
  const cancellations = screen.getByRole("tab", { name: /订单取消申请/ });
  expect(cancellations.getAttribute("tabindex")).toBe("0");
  expect(document.activeElement).toBe(cancellations);
  fireEvent.keyDown(cancellations, { key: "ArrowRight" });
  await screen.findByText("Case content");
});
