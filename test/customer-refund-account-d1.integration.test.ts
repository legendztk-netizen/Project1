import { beforeAll, afterAll, expect, it } from "vitest";
import {
  createRefundAccountService,
  type BankDetails,
  type RefundAccountProtector,
} from "../app/modules/after-sales/application/refund-account-service";
import { createRefundInitiationService } from "../app/modules/after-sales/application/refund-initiation-service";
import { createCaseService } from "../app/modules/after-sales/application/case-service";
import { createReturnAuthorizationService } from "../app/modules/after-sales/application/return-authorization-service";
import { createReturnInspectionService } from "../app/modules/after-sales/application/return-inspection-service";
import { createAesGcmNotificationProtector } from "../app/modules/quote-notifications/infrastructure/protected-payload";
import {
  owner,
  reviewer,
  refunder,
  unprivileged,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  caseVersion,
} from "./fixtures/after-sales-order";
let db: D1Database;
let dispose: () => Promise<void>;
let protector: RefundAccountProtector;
const now = () => new Date("2026-09-28T15:00:00.000Z");
const bank: BankDetails = {
  holderName: "Test Buyer LLC",
  holderAddress: "1 Test St, Portland, OR, US",
  bankName: "Test Bank",
  bankCountry: "US",
  accountNumber: "123456789012",
  routingCode: "021000021",
  swiftCode: "",
  accountType: "checking",
  bankAddress: "",
};
beforeAll(async () => {
  const started = await startAfterSalesDatabase("customer-refund-account");
  db = started.db;
  dispose = started.dispose;
  protector = createAesGcmNotificationProtector(
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  );
}, 90000);
afterAll(async () => {
  await dispose?.();
});
const accounts = () => createRefundAccountService(db, { protector, now });
const refunds = () => createRefundInitiationService(db, { protector, now });
async function returned(
  prefix: string,
  actualChannel: "bank_transfer" | "paypal" = "bank_transfer",
) {
  const order = await seedAfterSalesOrder(db, prefix, { actualChannel });
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  const line = {
    lineId: order.lines.standard,
    shipmentId: order.shipments.first,
    physicalQuantity: 2,
  };
  const caseId = await createCaseService(db, {
    now: () => new Date("2026-09-12T12:00:00Z"),
  }).customerOpen("buyer", {
    orderId: order.orderId,
    reason: "damaged",
    description: "Damaged fittings",
    lines: [line],
    commandId: crypto.randomUUID(),
  });
  const raId = await createReturnAuthorizationService(db, {
    now: () => new Date("2026-09-14T15:00:00Z"),
  }).adminIssue(owner, {
    orderId: order.orderId,
    caseId,
    expectedVersion: await caseVersion(db, caseId),
    locationId: "plano-returns",
    instructions: "Return fittings",
    lines: [line],
    commandId: crypto.randomUUID(),
  });
  const inspect = createReturnInspectionService(db, { now });
  const ids: string[] = [];
  for (let n = 0; n < 2; n++) {
    const receiptId = await inspect.adminRecordReceipt(owner, {
      orderId: order.orderId,
      raId,
      receivedAt: "2026-09-18T14:00:00Z",
      source: "Intake",
      lines: [{ ...line, physicalQuantity: 1 }],
      commandId: crypto.randomUUID(),
    });
    await inspect.adminDecide(owner, {
      orderId: order.orderId,
      receiptId,
      responsibility: "seller",
      remedy: "refund",
      items: [{ ...line, approvedQuantity: 1 }],
      commandId: crypto.randomUUID(),
    });
    const records = await refunds().adminOrder(owner, order.orderId);
    ids.push(records.afterSales.at(-1)!.id);
  }
  return { order, caseId, ids };
}
it("accepts encrypted customer bank details, masks reads, versions edits and completes only the fully settled case", async () => {
  const { order, caseId, ids } = await returned("bank-flow");
  const input = {
    orderId: order.orderId,
    expectedVersion: 0,
    details: bank,
    samePurchasingContext: true,
    commandId: crypto.randomUUID(),
  };
  expect((await accounts().customerRead("buyer", order.orderId)).eligible).toBe(
    true,
  );
  await expect(
    accounts().customerSubmit("someone-else", input),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    accounts().customerSubmit("buyer", {
      ...input,
      samePurchasingContext: false,
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    accounts().customerSubmit("buyer", {
      ...input,
      details: { ...bank, routingCode: "" },
    }),
  ).rejects.toMatchObject({ status: 400 });
  const first = await accounts().customerSubmit("buyer", input);
  expect(await accounts().customerSubmit("buyer", input)).toBe(first);
  await expect(
    accounts().customerSubmit("buyer", {
      ...input,
      details: { ...bank, accountNumber: "999999999999" },
    }),
  ).rejects.toMatchObject({ status: 409 });
  const customer = await accounts().customerRead("buyer", order.orderId);
  expect(customer.account).toMatchObject({ accountLast4: "9012", version: 1 });
  expect(customer.details).toEqual(bank);
  await expect(
    accounts().customerRead("other", order.orderId),
  ).rejects.toMatchObject({ status: 404 });
  const reviewerView = await accounts().adminRead(reviewer, order.orderId);
  expect(reviewerView.details).toBeNull();
  expect((await accounts().adminRead(refunder, order.orderId)).details).toEqual(
    bank,
  );
  await expect(
    accounts().adminRead(unprivileged, order.orderId),
  ).rejects.toMatchObject({ status: 403 });
  const stored = await db
    .prepare(
      "SELECT protected_details,command_hash FROM after_sales_customer_bank_accounts WHERE id=?",
    )
    .bind(first)
    .first<{ protected_details: string; command_hash: string }>();
  expect(JSON.stringify(stored)).not.toContain(bank.accountNumber);
  const audit = await db
    .prepare(
      "SELECT payload_json FROM admin_audit_events WHERE event_type='order.refund_account_provided'",
    )
    .all();
  expect(JSON.stringify(audit)).not.toContain(bank.accountNumber);
  const edits = await Promise.allSettled(
    [1, 2].map((n) =>
      accounts().customerSubmit("buyer", {
        ...input,
        expectedVersion: 1,
        details: { ...bank, accountNumber: `44444444444${n}` },
        commandId: crypto.randomUUID(),
      }),
    ),
  );
  expect(edits.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const latest = (await accounts().customerRead("buyer", order.orderId))
    .account!;
  expect(latest.version).toBe(2);
  const state = await refunds().adminOrder(owner, order.orderId);
  expect(state.destinations.map((d) => d.id)).toEqual([latest.id]);
  const amount = state.afterSales.find((r) => r.id === ids[0])!.remainingCents;
  const remittance = {
    orderId: order.orderId,
    refundKind: "after_sales" as const,
    refundId: ids[0],
    destinationId: latest.id,
    amountCents: amount,
    initiatedDateEt: "2026-09-28",
    externalReference: "wire-one",
    commandId: crypto.randomUUID(),
    accountVerified: true,
    complete: true,
  };
  await expect(
    refunds().adminRecordInitiation(refunder, {
      ...remittance,
      destinationId: first,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    refunds().adminRecordInitiation(refunder, {
      ...remittance,
      accountVerified: false,
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    refunds().adminRecordInitiation(refunder, {
      ...remittance,
      amountCents: amount - 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await refunds().adminRecordInitiation(refunder, {
    ...remittance,
    amountCents: amount - 1,
    complete: false,
    commandId: crypto.randomUUID(),
  });
  expect(
    await db
      .prepare("SELECT status FROM after_sales_cases WHERE id=?")
      .bind(caseId)
      .first("status"),
  ).toBe("open");
  await refunds().adminRecordInitiation(refunder, {
    ...remittance,
    amountCents: 1,
  });
  expect(
    await db
      .prepare("SELECT status FROM after_sales_cases WHERE id=?")
      .bind(caseId)
      .first("status"),
  ).toBe("open");
  const remaining = (
    await refunds().adminOrder(owner, order.orderId)
  ).afterSales.find((r) => r.id === ids[1])!.remainingCents;
  const last = {
    ...remittance,
    refundId: ids[1],
    amountCents: remaining,
    externalReference: "wire-two",
    commandId: crypto.randomUUID(),
  };
  const initiation = await refunds().adminRecordInitiation(refunder, last);
  expect(await refunds().adminRecordInitiation(refunder, last)).toBe(
    initiation,
  );
  await expect(
    refunds().adminRecordInitiation(refunder, {
      ...last,
      externalReference: "different",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await db
      .prepare("SELECT status FROM after_sales_cases WHERE id=?")
      .bind(caseId)
      .first("status"),
  ).toBe("closed");
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM after_sales_case_messages WHERE case_id=? AND id LIKE 'case-refund-completed:%'",
      )
      .bind(caseId)
      .first("n"),
  ).toBe(1);
  expect((await accounts().customerRead("buyer", order.orderId)).eligible).toBe(
    false,
  );
  expect(
    (await accounts().customerRead("buyer", order.orderId)).details,
  ).toBeNull();
  await expect(
    accounts().customerSubmit("buyer", {
      ...input,
      expectedVersion: 2,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
}, 90000);
it("does not solicit bank information before refund approval", async () => {
  const order = await seedAfterSalesOrder(db, "bank-ineligible");
  expect((await accounts().customerRead("buyer", order.orderId)).eligible).toBe(
    false,
  );
  expect(
    (await accounts().customerRead("buyer", order.orderId)).details,
  ).toBeNull();
  await expect(
    accounts().customerSubmit("buyer", {
      orderId: order.orderId,
      expectedVersion: 0,
      details: bank,
      samePurchasingContext: true,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
});

it.each(["bank_transfer", "paypal"] as const)(
  "accepts encrypted PayPal details for %s payments and enforces alternative-channel approval",
  async (channel) => {
    const { order, ids, caseId } = await returned(`paypal-${channel}`, channel);
    const details = {
      channel: "paypal" as const,
      holderName: "Test Buyer LLC",
      paypalEmail: "refunds@example.test",
    };
    const input = {
      orderId: order.orderId,
      expectedVersion: 0,
      details,
      samePurchasingContext: true,
      commandId: crypto.randomUUID(),
    };
    await expect(
      accounts().customerSubmit("buyer", {
        ...input,
        details: { ...details, paypalEmail: "invalid" },
      }),
    ).rejects.toMatchObject({ status: 400 });
    const id = await accounts().customerSubmit("buyer", input);
    expect(await accounts().customerSubmit("buyer", input)).toBe(id);
    const customer = await accounts().customerRead("buyer", order.orderId);
    expect(customer.account).toMatchObject({
      channel: "paypal",
      accountLast4: null,
      kind: channel === "paypal" ? "original_channel" : "alternative",
    });
    expect(customer.details).toEqual(details);
    await expect(
      accounts().customerRead("other", order.orderId),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await accounts().adminRead(refunder, order.orderId)).details,
    ).toEqual(details);
    expect(
      (await accounts().adminRead(reviewer, order.orderId)).details,
    ).toBeNull();
    const stored = await db
      .prepare("SELECT * FROM after_sales_customer_bank_accounts WHERE id=?")
      .bind(id)
      .first();
    expect(JSON.stringify(stored)).not.toContain(details.paypalEmail);
    const dest = await db
      .prepare("SELECT * FROM after_sales_refund_destinations WHERE id=?")
      .bind(id)
      .first();
    expect(JSON.stringify(dest)).not.toContain(details.paypalEmail);
    for (const refundId of ids) {
      const r = (
        await refunds().adminOrder(owner, order.orderId)
      ).afterSales.find((r) => r.id === refundId)!;
      const payment = {
        orderId: order.orderId,
        refundKind: "after_sales" as const,
        refundId,
        destinationId: id,
        accountVerified: true,
        complete: true,
        amountCents: r.remainingCents,
        initiatedDateEt: "2026-09-28",
        externalReference: `paypal-${refundId}`,
        commandId: crypto.randomUUID(),
      };
      if (channel === "bank_transfer") {
        await expect(
          refunds().adminRecordInitiation(refunder, payment),
        ).rejects.toMatchObject({ status: 400 });
        await refunds().ownerApproveDestination(owner, {
          orderId: order.orderId,
          destinationId: id,
          refundKind: "after_sales",
          refundId,
          reason: "Customer requested PayPal for this refund",
          commandId: crypto.randomUUID(),
        });
      }
      await refunds().adminRecordInitiation(refunder, payment);
    }
    expect(
      await db
        .prepare("SELECT status FROM after_sales_cases WHERE id=?")
        .bind(caseId)
        .first("status"),
    ).toBe("closed");
  },
  90000,
);
