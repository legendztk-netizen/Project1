// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  CustomerRefundAccountAction,
  CustomerRefundAccountStatus,
} from "../app/modules/after-sales/ui/customer-refund-account";
import { RefundCompletionForm } from "../app/modules/after-sales/ui/refund-completion-form";
import type { CustomerRefundAccount } from "../app/modules/after-sales/application/refund-account-service";
import { useState, type ReactNode } from "react";
afterEach(cleanup);
function show(node: ReactNode) {
  render(
    <RouterProvider
      router={createMemoryRouter([{ path: "/", element: node }])}
    />,
  );
}
const account: CustomerRefundAccount = {
  eligible: true,
  channel: "bank_transfer",
  account: null,
  details: null,
};
it("offers a refund-account dialog only for a payable refund and identifies required routing fields", async () => {
  show(
    <CustomerRefundAccountAction
      account={{ ...account, eligible: false }}
      commandId="test"
    />,
  );
  expect(screen.queryByRole("button", { name: "Refund account" })).toBeNull();
  cleanup();
  show(
    <>
      <CustomerRefundAccountAction account={account} commandId="test" />
      <CustomerRefundAccountStatus account={account} />
    </>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Refund account" }),
  );
  const form = document.querySelector("form")!;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement;
  expect(field("routingCode").required).toBe(true);
  expect(field("swiftCode").required).toBe(false);
  expect(field("samePurchasingContext").required).toBe(true);
  expect(field("expectedVersion").value).toBe("0");
  fireEvent.change(field("bankCountry"), { target: { value: "GB" } });
  expect(field("routingCode").required).toBe(false);
  expect(field("swiftCode").required).toBe(true);
  expect(
    screen.getByText(/submitting this form does not transfer money/),
  ).toBeTruthy();
});
it("prefills all saved bank fields and submits edits against the displayed version", async () => {
  const saved: CustomerRefundAccount = {
    ...account,
    details: {
      holderName: "Saved Buyer",
      bankName: "Saved Bank",
      bankCountry: "GB",
      accountNumber: "GB123412341234",
      routingCode: "123456",
      swiftCode: "TESTGB22",
      accountType: "savings",
      holderAddress: "1 Saved Road",
      bankAddress: "2 Bank Road",
    },
    account: {
      id: "bank-2",
      channel: "bank_transfer" as const,
      kind: "original_channel" as const,
      version: 2,
      accountLast4: "1234",
      submittedAt: "2026-09-28T00:00:00Z",
    },
  };
  show(
    <>
      <CustomerRefundAccountAction account={saved} commandId="test" />
      <CustomerRefundAccountStatus account={saved} />
    </>,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Refund account provided",
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Update refund account" }),
  );
  expect(
    (document.querySelector('[name="expectedVersion"]') as HTMLInputElement)
      .value,
  ).toBe("2");
  expect(
    (document.querySelector('[name="accountNumber"]') as HTMLInputElement)
      .value,
  ).toBe("GB123412341234");
  const form = document.querySelector("form")!;
  const initial = new FormData(form);
  for (const [key, value] of Object.entries(saved.details!))
    expect(initial.get(key)).toBe(value);
  expect(
    (document.querySelector('[name="routingCode"]') as HTMLInputElement)
      .required,
  ).toBe(false);
  expect(
    (document.querySelector('[name="swiftCode"]') as HTMLInputElement).required,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Bank name"), {
    target: { value: "Updated Bank" },
  });
  const updated = new FormData(form);
  expect(updated.get("bankName")).toBe("Updated Bank");
  expect(updated.get("accountNumber")).toBe("GB123412341234");
});
it("binds completion to the selected refund's remaining amount and requires a remittance confirmation", () => {
  show(
    <RefundCompletionForm
      payable={[
        { kind: "after_sales", id: "a", label: "退款 A", remainingCents: 180 },
        { kind: "after_sales", id: "b", label: "退款 B", remainingCents: 250 },
      ]}
      destinations={[
        {
          id: "account",
          label: "客户提供的银行账号",
          accountLast4: "1234",
          kind: "original_channel",
        },
      ]}
      approvals={[]}
      commandId="test"
      todayEt="2026-09-28"
      busy={false}
    />,
  );
  const form = document.querySelector("form")!;
  fireEvent.change(screen.getByLabelText("本次已汇款的退款"), {
    target: { value: "after_sales:b" },
  });
  const data = new FormData(form);
  expect(data.get("amountUsd")).toBe("2.50");
  expect(data.get("complete")).toBe("true");
  expect(
    (form.elements.namedItem("accountVerified") as HTMLInputElement).required,
  ).toBe(true);
  expect(
    (form.elements.namedItem("externalReference") as HTMLInputElement).required,
  ).toBe(true);
  expect(form.checkValidity()).toBe(false);
  expect(screen.getByRole("button", { name: "已汇款，退款完成" })).toBeTruthy();
});

it("offers PayPal without bank fields and explains a change of refund method", async () => {
  show(<CustomerRefundAccountAction account={account} commandId="paypal-ui" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Refund account" }),
  );
  fireEvent.change(screen.getByLabelText("Refund method"), {
    target: { value: "paypal" },
  });
  expect(
    screen.getByLabelText("PayPal email address").getAttribute("type"),
  ).toBe("email");
  expect(document.querySelector('[name="bankName"]')).toBeNull();
  expect(document.querySelector('[name="accountNumber"]')).toBeNull();
  expect(
    screen.getByText(/different refund method requires review/),
  ).toBeTruthy();
  const form = document.querySelector("form")!;
  expect(new FormData(form).get("channel")).toBe("paypal");
  expect(form.checkValidity()).toBe(false);
});
it("defaults to PayPal for an original PayPal payment", async () => {
  show(
    <CustomerRefundAccountAction
      account={{ ...account, channel: "paypal" }}
      commandId="paypal-original"
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Refund account" }),
  );
  expect(screen.getByLabelText("PayPal email address")).toBeTruthy();
  expect(
    screen.queryByText(/different refund method requires review/),
  ).toBeNull();
});

it("prefills the saved PayPal holder and email so only changed fields need editing", async () => {
  const saved: CustomerRefundAccount = {
    ...account,
    account: {
      id: "paypal-2",
      channel: "paypal",
      kind: "alternative",
      version: 2,
      accountLast4: null,
      submittedAt: "2026-09-28T00:00:00Z",
    },
    details: {
      channel: "paypal",
      holderName: "Saved PayPal Buyer",
      paypalEmail: "saved@example.test",
    },
  };
  show(
    <CustomerRefundAccountAction account={saved} commandId="paypal-update" />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Update refund account" }),
  );
  const form = document.querySelector("form")!;
  const initial = new FormData(form);
  expect(initial.get("channel")).toBe("paypal");
  expect(initial.get("holderName")).toBe("Saved PayPal Buyer");
  expect(initial.get("paypalEmail")).toBe("saved@example.test");
  expect(initial.get("expectedVersion")).toBe("2");
  expect(document.querySelector('[name="bankName"]')).toBeNull();
  fireEvent.change(screen.getByLabelText("PayPal email address"), {
    target: { value: "updated@example.test" },
  });
  expect(new FormData(form).get("paypalEmail")).toBe("updated@example.test");
});

it("keeps the displayed version during revalidation and loads the latest details when reopened", async () => {
  function Order() {
    const [version, setVersion] = useState(1);
    const saved: CustomerRefundAccount = {
      ...account,
      account: {
        id: `paypal-${version}`,
        channel: "paypal",
        kind: "alternative",
        version,
        accountLast4: null,
        submittedAt: "2026-09-28T00:00:00Z",
      },
      details: {
        channel: "paypal",
        holderName: "Buyer",
        paypalEmail: `version${version}@example.test`,
      },
    };
    return (
      <>
        <button onClick={() => setVersion(2)}>Refresh saved account</button>
        <CustomerRefundAccountAction account={saved} commandId="refresh" />
      </>
    );
  }
  show(<Order />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Update refund account" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh saved account" }),
  );
  let data = new FormData(document.querySelector("form")!);
  expect(data.get("expectedVersion")).toBe("1");
  expect(data.get("paypalEmail")).toBe("version1@example.test");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Update refund account" }),
  );
  data = new FormData(document.querySelector("form")!);
  expect(data.get("expectedVersion")).toBe("2");
  expect(data.get("paypalEmail")).toBe("version2@example.test");
});

it("requires alternative-account approval for the exact refund and account, including after switching refunds", () => {
  show(
    <RefundCompletionForm
      payable={[
        { kind: "after_sales", id: "a", label: "退款 A", remainingCents: 5000 },
        { kind: "after_sales", id: "b", label: "退款 B", remainingCents: 2000 },
      ]}
      destinations={[
        {
          id: "paypal",
          label: "客户 PayPal",
          accountLast4: null,
          kind: "alternative",
        },
        {
          id: "updated",
          label: "客户更新的 PayPal",
          accountLast4: null,
          kind: "alternative",
        },
      ]}
      approvals={[
        { destinationId: "paypal", refundKind: "after_sales", refundId: "b" },
        { destinationId: "updated", refundKind: "shipping", refundId: "a" },
      ]}
      commandId="approval-ui"
      todayEt="2026-09-28"
      busy={false}
    />,
  );
  const button = screen.getByRole("button", { name: "已汇款，退款完成" });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("status").textContent).toContain(
    "Owner 批准替代账户",
  );
  fireEvent.change(screen.getByLabelText("本次已汇款的退款"), {
    target: { value: "after_sales:b" },
  });
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("option", { name: "客户 PayPal" })).toBeTruthy();
  expect(
    screen.queryByRole("option", { name: "客户更新的 PayPal" }),
  ).toBeNull();
  expect(
    new FormData(document.querySelector("form")!).get("destinationId"),
  ).toBe("paypal");
  fireEvent.change(screen.getByLabelText("本次已汇款的退款"), {
    target: { value: "after_sales:a" },
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(
    new FormData(document.querySelector("form")!).get("destinationId"),
  ).not.toBe("paypal");
  expect(
    screen.getByLabelText("实际使用的退款账号").hasAttribute("disabled"),
  ).toBe(true);
});
