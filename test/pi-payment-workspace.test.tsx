// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createMemoryRouter,
  data,
  RouterProvider,
  useActionData,
  useLoaderData,
} from "react-router";
import Workspace from "../app/modules/admin/ui/pi-payments-workspace";
import type { PiPaymentsPageData } from "../app/modules/admin/routes/pi-payments";

vi.mock("../app/modules/admin/ui/admin-navigation", () => ({
  AdminNavigation: () => null,
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);

function fixture(): PiPaymentsPageData {
  return {
    requestId: "request",
    commandId: "test-command",
    isOwner: true,
    agreement: {
      blockedReason: null,
      documentNumber: "PI-TEST",
      documentVersion: 1,
      headVersion: 1,
      acceptanceId: "acceptance",
      acceptedAt: "2026-09-01T00:00:00Z",
      snapshotHash: "hash",
      latestQuoteRevisionId: "quote",
      noPaymentDeadline: false,
      retained: false,
    },
    payment: {
      piId: "pi-old",
      documentNumber: "PI-TEST",
      buyerName: "Test buyer",
      currency: "USD",
      totalDueCents: 10000,
      amountReceivedCents: 0,
      applicableCents: 0,
      balanceCents: 10000,
      excessCents: 0,
      allocatedInCents: 0,
      allocatedOutCents: 0,
      refundedCents: 0,
      receiptHistoryKnown: true,
      hasEverReceived: false,
      paymentConfirmed: false,
      current: true,
      version: 4,
      instructionId: "bank-v1",
      instructionVersion: 1,
      instructionChannel: "bank_transfer",
      actualChannel: "bank_transfer",
      termKind: "fixed_et_date",
      dueAt: "2026-10-01T23:59:59Z",
      dueDateEt: "2026-10-01",
      acceptedAt: "2026-09-01T00:00:00Z",
      orderId: null,
      originalCurrencyReceipts: [],
      receiptInstructionHistory: [],
    },
    late: { overdue: false, extensions: [], reviews: [] },
    funds: { availableCents: 0, resolutions: [] },
    correction: { disputes: [] },
    choices: [
      { id: "bank-v1", channel: "bank_transfer", version: 1 },
      { id: "paypal-v1", channel: "paypal", version: 1 },
    ],
    instructionVersions: [
      { id: "bank-v1", channel: "bank_transfer", version: 1, status: "active" },
    ],
    target: null,
    targetId: "",
    targetError: null,
    history: [],
  } as unknown as PiPaymentsPageData;
}
async function show(basis = fixture(), fail = false) {
  const submit = vi.fn(async ({ request }: { request: Request }) => {
    const form = await request.formData();
    submissions.push({ url: request.url, form });
    if (fail) return data({ error: "版本已更新，请重试。" }, { status: 409 });
    if (form.get("intent") === "retain-agreement") {
      basis.payment.acceptedAgreementRetained = true;
      basis.payment.paymentDeadlineUnspecified = true;
      basis.payment.version++;
      return { message: "已确认以客户接受的 PI 为最终协议。" };
    }
    basis.payment.amountReceivedCents = 2500;
    basis.payment.balanceCents = 7500;
    basis.payment.version++;
    return { message: "已保存付款操作。" };
  });
  const submissions: { url: string; form: FormData }[] = [];
  function Page() {
    return (
      <Workspace
        loaderData={useLoaderData() as PiPaymentsPageData}
        actionData={useActionData() as { error?: string; message?: string }}
      />
    );
  }
  const router = createMemoryRouter(
    [
      {
        path: "/payments",
        loader: ({ request }) => {
          const targetId = new URL(request.url).searchParams.get("targetPiId");
          if (!targetId) return basis;
          return {
            ...basis,
            targetId,
            targetError:
              targetId === "pi-target"
                ? null
                : "未找到目标 PI，请核对编号后重试。",
            target:
              targetId === "pi-target"
                ? {
                    piId: targetId,
                    documentNumber: "PI-TARGET",
                    version: 9,
                    current: true,
                    shortfallCents: 5000,
                  }
                : null,
          };
        },
        action: submit,
        Component: Page,
        HydrateFallback: () => null,
      },
    ],
    { initialEntries: ["/payments?piId=pi-old"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "付款与到账" });
  return { router, submit, submissions };
}

it("reviews the exact accepted legacy agreement and clears only the terms blocker", async () => {
  const basis = fixture();
  basis.payment.termKind = "legacy_review";
  basis.payment.dueAt = null;
  basis.agreement.noPaymentDeadline = true;
  const result = await show(basis);
  expect(screen.getByText("历史资料待核对")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "以客户已接受的 PI 为准" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("不补设日期");
  expect(
    (within(dialog).getByRole("checkbox") as HTMLInputElement).required,
  ).toBe(true);
  fireEvent.change(within(dialog).getByLabelText("保留原因"), {
    target: { value: "重复保存，保留客户已接受协议" },
  });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "确认保留原协议" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByText("历史资料待核对")).toBeNull();
  expect(screen.getByText("未约定截止日")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: /确认付款：到账金额尚未达到/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  const form = result.submissions[0].form;
  expect(Object.fromEntries(form.entries())).toMatchObject({
    intent: "retain-agreement",
    acceptanceId: "acceptance",
    documentVersion: "1",
    expectedVersion: "4",
    expectedHeadVersion: "1",
    snapshotHash: "hash",
    latestQuoteRevisionId: "quote",
    noPaymentDeadline: "true",
    reviewed: "on",
  });
});

it("opens one form at a time and warns before discarding edits", async () => {
  await show();
  expect(screen.queryByLabelText("累计到账金额（USD）")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更新到账金额" }));
  fireEvent.change(screen.getByLabelText("累计到账金额（USD）"), {
    target: { value: "25.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.getByRole("alert").textContent).toContain("尚未保存");
  fireEvent.click(screen.getByRole("button", { name: "继续填写" }));
  expect(
    (screen.getByLabelText("累计到账金额（USD）") as HTMLInputElement).value,
  ).toBe("25.00");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("offers non-USD currencies and changes amount precision with the selection", async () => {
  await show();
  fireEvent.click(screen.getByRole("tab", { name: /原币记录/ }));
  fireEvent.click(
    within(screen.getByRole("tabpanel")).getByRole("button", {
      name: "登记原币到账",
    }),
  );
  const currency = screen.getByLabelText(
    "原始币种（ISO 代码）",
  ) as unknown as HTMLSelectElement;
  const codes = Array.from(currency.options).map((option) => option.value);
  expect(codes).toEqual(
    expect.arrayContaining([
      "EUR",
      "CNY",
      "GBP",
      "JPY",
      "CAD",
      "AUD",
      "HKD",
      "SGD",
    ]),
  );
  expect(codes).not.toContain("USD");
  fireEvent.change(currency, { target: { value: "JPY" } });
  expect(screen.getByRole("spinbutton").getAttribute("step")).toBe("1");
  expect(screen.getByRole("spinbutton").getAttribute("min")).toBe("1");
  fireEvent.change(currency, { target: { value: "EUR" } });
  expect(screen.getByRole("spinbutton").getAttribute("step")).toBe("0.01");
});

it.each([false, true])(
  "keeps the source PI on submission; preserves failures or closes after success (%s)",
  async (fail) => {
    const { submissions } = await show(fixture(), fail);
    fireEvent.click(screen.getByRole("button", { name: "更新到账金额" }));
    fireEvent.change(screen.getByLabelText("累计到账金额（USD）"), {
      target: { value: "25.00" },
    });
    fireEvent.change(screen.getByLabelText("外部核验参考"), {
      target: { value: "test-receipt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存到账金额" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(new URL(submissions[0].url).searchParams.get("piId")).toBe("pi-old");
    expect(submissions[0].form.get("expectedVersion")).toBe("4");
    expect(submissions[0].form.get("amount")).toBe("25.00");
    expect(submissions[0].form.get("intent")).toBe("received");
    if (fail) {
      await screen.findByText("版本已更新，请重试。");
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(
        (screen.getByLabelText("外部核验参考") as HTMLInputElement).value,
      ).toBe("test-receipt");
      expect(
        (screen.getByLabelText("累计到账金额（USD）") as HTMLInputElement)
          .value,
      ).toBe("25.00");
    } else {
      await screen.findByText("已保存付款操作。");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByText("USD 25.00")).toBeTruthy();
    }
  },
);

it("keeps instruction changes locked after receipts were corrected to zero", async () => {
  const basis = fixture();
  basis.payment.hasEverReceived = true;
  await show(basis);
  fireEvent.click(screen.getByText("更多操作"));
  const button = screen.getByRole("button", { name: /更改付款渠道和说明/ });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.parentElement?.title).toContain("已有到账历史");
});

it("looks up allocation targets without navigation and invalidates a changed target", async () => {
  const basis = fixture();
  basis.funds.availableCents = 5000;
  basis.funds.version = 4;
  const { router, submissions } = await show(basis);
  fireEvent.click(screen.getByRole("button", { name: "分配款项" }));
  fireEvent.change(screen.getByLabelText("目标 PI ID"), {
    target: { value: "missing" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核对目标 PI" }));
  await screen.findByText("未找到目标 PI，请核对编号后重试。");
  expect(router.state.location.search).toBe("?piId=pi-old");
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("目标 PI ID"), {
    target: { value: "pi-target" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核对目标 PI" }));
  await screen.findByLabelText("分配金额（USD）");
  expect(router.state.location.search).toBe("?piId=pi-old");
  fireEvent.change(screen.getByLabelText("分配金额（USD）"), {
    target: { value: "25.00" },
  });
  fireEvent.change(screen.getByLabelText("客户授权证据/引用"), {
    target: { value: "Test authorization" },
  });
  fireEvent.change(screen.getByLabelText("外部核验参考"), {
    target: { value: "Test receipt" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认分配" }));
  await waitFor(() => expect(submissions).toHaveLength(1));
  expect(submissions[0].form.get("targetPiId")).toBe("pi-target");
  expect(submissions[0].form.get("targetVersion")).toBe("9");
  expect(submissions[0].form.get("expectedVersion")).toBe("4");
  expect(new URL(submissions[0].url).searchParams.get("piId")).toBe("pi-old");
  await screen.findByText("已保存付款操作。");
  fireEvent.click(screen.getByRole("button", { name: "分配款项" }));
  fireEvent.change(screen.getByLabelText("目标 PI ID"), {
    target: { value: "pi-target" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核对目标 PI" }));
  await screen.findByLabelText("分配金额（USD）");
  fireEvent.change(screen.getByLabelText("目标 PI ID"), {
    target: { value: "another-pi" },
  });
  expect(screen.queryByLabelText("分配金额（USD）")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "确认分配" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("blocks normal confirmation during a dispute and reserves release review for Owner", async () => {
  const basis = fixture();
  basis.payment.balanceCents = 0;
  basis.isOwner = false;
  basis.correction.disputes = [
    { active: 1, pi_id: "pi-old", source_pi_id: "pi-old", correction_id: "c1" },
  ] as typeof basis.correction.disputes;
  await show(basis);
  expect(
    (screen.getByRole("button", { name: /^确认付款/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  const review = screen.getByRole("button", { name: /^审核放行/ });
  expect((review as HTMLButtonElement).disabled).toBe(true);
  expect(review.parentElement?.title).toContain("Owner");
});
