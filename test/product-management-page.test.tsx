// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
} from "react-router";
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
function setup(canEdit = true, delayEditor = false) {
  const children = [
    {
      ...row,
      kind: "sku" as const,
      code: "SKU-A",
      name: "SKU-A",
      amount: 12,
      currency: "USD",
      technicalStatus: "Inherited",
    },
    {
      ...row,
      kind: "sku" as const,
      code: "SKU-B",
      name: "SKU-B",
      amount: 35,
      currency: "EUR",
    },
  ];
  const props: Parameters<typeof ProductManagementPage>[0] = {
    page: {
      summary: { skuCount: 2, onlineCount: 2, missingPriceCount: 0 },
      items: [{ item: row, children }],
      page: 1,
      pages: 1,
      total: 1,
    },
    types: [],
    query: "",
    status: "",
    attention: "",
    pageSize: 20,
    state: { mode: "items", generation: 1, baseline_release_id: "release" },
    canEdit,
    canEnable: true,
    deletionPlan: null,
  };
  const saved = vi.fn(async () => ({ ok: true, result: "saved", error: null }));
  const editorCalls = vi.fn();
  let releaseEditor: () => void = () => {};
  const editorWait = new Promise<void>((resolve) => {
    releaseEditor = resolve;
  });
  function Page() {
    return <ProductManagementPage {...useLoaderData<typeof props>()} />;
  }
  const router = createMemoryRouter(
    [
      {
        path: "/admin/catalog/products",
        element: <Page />,
        loader: ({ request }) => {
          const params = new URL(request.url).searchParams;
          return {
            ...props,
            query: params.get("q") ?? "",
            types: params.getAll("type"),
            status: params.get("status") ?? "",
            attention: params.get("attention") ?? "",
          };
        },
        hydrateFallbackElement: <p>Loading</p>,
        action: saved,
      },
      {
        path: "/admin/catalog/product-editor",
        loader: async ({ request }) => {
          editorCalls(request.url);
          if (delayEditor) await editorWait;
          return {
            payload: null,
            productType: new URL(request.url).searchParams.get("type"),
            kind: new URL(request.url).searchParams.get("kind"),
            initialSeries: new URL(request.url).searchParams.get("series"),
            targetState: "online",
            commandId: "cmd",
            baselineRevisionId: null,
            canEdit,
            series: [row],
            media: [],
          };
        },
      },
    ],
    { initialEntries: ["/admin/catalog/products"] },
  );
  render(<RouterProvider router={router} />);
  return { saved, router, editorCalls, releaseEditor };
}
describe("manage all products", () => {
  it("keeps parent selection independent and restricts mixed and multiple SKU operations", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "展开 S" }));
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
  it("uses the add wizard; currency changes clear price and closing protects unsaved edits", async () => {
    const { saved } = setup();
    const add = await screen.findByRole("button", { name: "＋ 新增产品" });
    fireEvent.focus(add);
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: /03 套筒/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写资料 →" }));
    const amount = await screen.findByLabelText("Retail Unit Price / 零售单价");
    const dialog = screen.getByRole("dialog");
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
  it("offers an image upload and submits the editor as multipart form data", async () => {
    const { saved } = setup();
    const add = await screen.findByRole("button", { name: "＋ 新增产品" });
    fireEvent.focus(add);
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: /03 套筒/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写资料 →" }));
    const upload = (await screen.findByLabelText(
      /Upload New Image/,
    )) as HTMLInputElement;
    const dialog = screen.getByRole("dialog");
    expect(upload.type).toBe("file");
    expect(upload.accept).toBe("image/jpeg,image/png,image/webp");
    expect(upload.name).toBe("mainImageUpload");
    expect(within(dialog).getByLabelText(/Image Source Notes/)).toBeTruthy();
    const file = new File(["png"], "adapter.png", { type: "image/png" });
    fireEvent.change(upload, { target: { files: [file] } });
    fireEvent.submit(upload.closest("form")!);
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const call = saved.mock.calls[0] as unknown as [{ request: Request }];
    expect(call[0].request.headers.get("content-type")).toMatch(
      /^multipart\/form-data/,
    );
  });
  it("disables write actions for view permission", async () => {
    setup(false);
    expect(
      await screen.findByRole("button", { name: "＋ 新增产品" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择系列 S" }));
    expect(screen.getByRole("button", { name: "删除" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("button", { name: "编辑 S" })).toBeNull();
  });
  it("keeps filters in the URL, resets pagination and restores search on back navigation", async () => {
    const { router } = setup();
    const search = await screen.findByLabelText("查找产品");
    fireEvent.change(search, { target: { value: "SKU-A" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => expect(router.state.location.search).toBe("?q=SKU-A"));
    expect(
      await screen.findByRole("checkbox", { name: "选择SKU SKU-A" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("发布状态"), {
      target: { value: "draft" },
    });
    await waitFor(() =>
      expect(router.state.location.search).toContain("status=draft"),
    );
    fireEvent.click(screen.getByRole("button", { name: "胶管" }));
    await waitFor(() =>
      expect(router.state.location.search).toContain("type=hose"),
    );
    fireEvent.click(screen.getByRole("button", { name: "清空筛选" }));
    await waitFor(() => expect(search).toHaveProperty("value", ""));
    await router.navigate(-1);
    await waitFor(() => expect(search).toHaveProperty("value", "SKU-A"));
    expect(screen.getByLabelText("发布状态")).toHaveProperty("value", "draft");
  });
  it("shows currency-specific ranges and expands all without flagging inherited data as missing", async () => {
    setup();
    expect(await screen.findByText("USD 12")).toBeTruthy();
    expect(screen.getByText("EUR 35")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "展开全部" }));
    expect(
      screen.getByRole("checkbox", { name: "选择SKU SKU-B" }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("table")).queryByText("技术资料待完善"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "收起全部" }));
    expect(
      screen.queryByRole("checkbox", { name: "选择SKU SKU-B" }),
    ).toBeNull();
  });
  it("shows loading feedback then prefills the parent when adding a SKU", async () => {
    const { editorCalls, releaseEditor } = setup(true, true);
    fireEvent.click(
      await screen.findByRole("button", { name: "在 S 下新增 SKU" }),
    );
    expect(
      await screen.findByText("正在读取规格、价格和可选系列…"),
    ).toBeTruthy();
    expect(editorCalls.mock.calls[0][0]).toContain("series=S");
    releaseEditor();
    const parent = await screen.findByRole("combobox", { name: /Hose Series/ });
    expect(parent).toHaveProperty("value", "S");
  });
});
