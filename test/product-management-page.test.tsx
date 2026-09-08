// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ProductManagementPage } from "../app/modules/admin/ui/product-management-page";
import type { ManagedProduct } from "../app/modules/catalog/infrastructure/d1-product-management-repository";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const row: ManagedProduct = {
  kind: "series",
  productType: "hose",
  code: "S",
  seriesCode: "S",
  name: "Series S",
  imageId: null,
  dimensions: "",
  amount: null,
  currency: "USD",
  state: "online",
  revisionId: null,
  draftRevisionId: null,
  assemblyPending: false,
};
function setup(canEdit = true) {
  const children = [
    { ...row, kind: "sku" as const, code: "SKU-A", name: "SKU-A" },
    { ...row, kind: "sku" as const, code: "SKU-B", name: "SKU-B" },
  ];
  const props: Parameters<typeof ProductManagementPage>[0] = {
    page: { items: [{ item: row, children }], page: 1, pages: 1, total: 1 },
    types: [],
    query: "",
    pageSize: 20,
    state: { mode: "items", generation: 1, baseline_release_id: "release" },
    canEdit,
    canEnable: true,
    deletionPlan: null,
  };
  const saved = vi.fn(async () => ({ ok: true, result: "saved", error: null }));
  const router = createMemoryRouter(
    [
      {
        path: "/admin/catalog/products",
        element: <ProductManagementPage {...props} />,
        action: saved,
      },
      {
        path: "/admin/catalog/product-editor",
        loader: ({ request }) => ({
          payload: null,
          productType: new URL(request.url).searchParams.get("type"),
          kind: "sku",
          targetState: "online",
          commandId: "cmd",
          baselineRevisionId: null,
          canEdit,
          series: [row],
          media: [],
        }),
      },
    ],
    { initialEntries: ["/admin/catalog/products"] },
  );
  render(<RouterProvider router={router} />);
  return saved;
}
describe("manage all products", () => {
  it("keeps parent selection independent and restricts mixed and multiple SKU operations", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "展开 S" }));
    const series = screen.getByRole("checkbox", { name: "选择系列 S" });
    const a = screen.getByRole("checkbox", { name: "选择SKU SKU-A" });
    const b = screen.getByRole("checkbox", { name: "选择SKU SKU-B" });
    fireEvent.click(series);
    expect(a).toHaveProperty("checked", false);
    fireEvent.click(a);
    expect(screen.getByRole("button", { name: "编辑" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "删除" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(series);
    fireEvent.click(b);
    expect(screen.getByRole("button", { name: "编辑" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "删除" })).toHaveProperty(
      "disabled",
      false,
    );
  });
  it("opens the add menu by focus and click; edits are not saved on close", async () => {
    const saved = setup();
    const add = screen.getByRole("button", { name: "新增" });
    fireEvent.focus(add);
    fireEvent.click(add);
    const ferrule = screen.getByText("套筒", {
      selector: "strong",
    }).parentElement!;
    fireEvent.click(within(ferrule).getByRole("button", { name: "新增产品" }));
    const dialog = await screen.findByRole("dialog");
    const amount = within(dialog).getByLabelText(
      "Retail Unit Price / 零售单价",
    );
    fireEvent.change(amount, { target: { value: "25" } });
    fireEvent.change(within(dialog).getByLabelText("Currency / 币种"), {
      target: { value: "EUR" },
    });
    expect(amount).toHaveProperty("value", "");
    window.confirm = vi.fn(() => false);
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "关闭" }).at(-1)!,
    );
    expect(saved).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalled();
  });
  it("disables write actions for view permission", () => {
    setup(false);
    expect(screen.getByRole("button", { name: "新增" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "删除" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
