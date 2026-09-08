// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import CatalogRequests from "../app/modules/admin/routes/catalog-requests";
afterEach(cleanup);
function setup(canEdit = true, status = "pending") {
  const request = {
    id: "request-1",
    version: 1,
    batchId: "batch-1",
    status,
    createdBy: "owner",
    createdAt: "today",
    original: [
      { sheet: "07_价格包装", row: 2, values: { amount: 28 }, cells: [28] },
    ],
    baseline: null,
    issues: [],
    dependencies: [],
    command: {
      payload: {
        kind: "sku",
        productType: "hose",
        variant: { sku: "SKU-A", hoseSeries: "A" },
        price: { amount: 28, currency: "CNY", packageLengthFt: null },
        mediaVersionId: null,
      },
      targetState: "online",
    },
  };
  const action = vi.fn(async () => ({ error: null, results: [] }));
  const router = createMemoryRouter(
    [
      {
        path: "/admin/catalog/requests",
        element: <CatalogRequests />,
        loader: () => ({
          requests: [request],
          filters: {
            batch: "",
            status: "pending",
            target: "",
            sheet: "",
            series: "",
            q: "",
          },
          series: ["A"],
          batches: [],
          relations: [],
          detail: null,
          affected: [],
          media: [],
          canEdit,
          mode: "items",
          batchId: "batch-1",
        }),
        action,
      },
    ],
    { initialEntries: ["/admin/catalog/requests"] },
  );
  render(<RouterProvider router={router} />);
  return action;
}
it("requires explicit selection and uses separate request and target-state filters", async () => {
  setup();
  await screen.findByRole("heading", { name: "产品更新请求审核" });
  expect(screen.getByLabelText<HTMLSelectElement>("更新请求状态").value).toBe(
    "pending",
  );
  expect(screen.getByLabelText("目标产品状态")).toBeTruthy();
  const button = screen.getByRole("button", {
    name: "批准选中条目",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 SKU-A" }));
  expect(button.disabled).toBe(false);
  expect(
    screen.getByRole("link", { name: "更多" }).getAttribute("href"),
  ).toContain("detail=request-1");
});
it("keeps approved requests and read-only accounts from selecting mutations", async () => {
  setup(false, "approved");
  await screen.findByRole("heading", { name: "产品更新请求审核" });
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
    true,
  );
  expect(screen.queryByRole("button", { name: "批准选中条目" })).toBeNull();
});
