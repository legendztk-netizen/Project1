import { afterAll, beforeAll, expect, it } from "vitest";

import { createCaseService } from "../app/modules/after-sales/application/case-service";
import { createReturnAuthorizationService } from "../app/modules/after-sales/application/return-authorization-service";
import {
  owner,
  reviewer,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  unprivileged,
  type SeededOrder,
  caseVersion,
} from "./fixtures/after-sales-order";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-ra");
  db = started.db;
  dispose = started.dispose;
  await db
    .prepare(
      `INSERT INTO seller_return_locations(id,label,address,phone,purpose,updated_at)
       VALUES ('reno-returns','Reno Return Location',
         '100 Test Way\nReno, NV 89501\nUnited States','+1 7755550100',
         'Approved returns only','2026-09-01T00:00:00.000Z'),
       ('incomplete','Draft location','Single line','','Draft',
         '2026-09-01T00:00:00.000Z')`,
    )
    .run();
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const ra = (now: string) =>
  createReturnAuthorizationService(db, { now: () => new Date(now) });

async function caseFor(prefix: string) {
  const order = await seedAfterSalesOrder(db, prefix);
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  const caseId = await createCaseService(db, {
    now: () => new Date("2026-09-12T12:00:00.000Z"),
  }).customerOpen("buyer", {
    orderId: order.orderId,
    reason: "convenience_return",
    description: "Ordered too many",
    lines: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        physicalQuantity: 2,
      },
    ],
    commandId: crypto.randomUUID(),
  });
  return { order, caseId };
}

const issue = (
  order: SeededOrder,
  caseId: string,
  now: string,
  extra: Partial<Parameters<ReturnType<typeof ra>["adminIssue"]>[1]> = {},
) =>
  caseVersion(db, caseId).then((expectedVersion) =>
    ra(now).adminIssue(reviewer, {
      orderId: order.orderId,
      caseId,
      expectedVersion,
      locationId: "reno-returns",
      instructions: "Pack in original box; write the RA number on the label.",
      lines: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.first,
          physicalQuantity: 2,
        },
      ],
      commandId: crypto.randomUUID(),
      ...extra,
    }),
  );

it("freezes the selected location and discloses it only to the authorized customer after issuance", async () => {
  const { order, caseId } = await caseFor("a1");
  expect(
    JSON.stringify(
      await ra("2026-09-12T12:00:00.000Z").customerRead("buyer", order.orderId),
    ),
  ).toBe("[]");
  await expect(
    issue(order, caseId, "2026-09-12T12:00:00.000Z", {
      locationId: "incomplete",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    ra("2026-09-12T12:00:00.000Z").adminIssue(unprivileged, {
      orderId: order.orderId,
      caseId,
      expectedVersion: await caseVersion(db, caseId),
      locationId: "reno-returns",
      instructions: "x",
      lines: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.first,
          physicalQuantity: 1,
        },
      ],
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  const command = crypto.randomUUID();
  // A retried form carries the version the page was rendered with.
  const expectedVersion = await caseVersion(db, caseId);
  const raId = await issue(order, caseId, "2026-10-10T14:00:00.000Z", {
    commandId: command,
    expectedVersion,
  });
  expect(
    await issue(order, caseId, "2026-10-10T14:00:00.000Z", {
      commandId: command,
      expectedVersion,
    }),
  ).toBe(raId);
  // Later location edits do not change the issued RA.
  await db
    .prepare(
      "UPDATE seller_return_locations SET address='999 Changed Rd\nReno, NV' WHERE id='reno-returns'",
    )
    .run();
  const [customerRa] = await ra("2026-10-11T12:00:00.000Z").customerRead(
    "buyer",
    order.orderId,
  );
  expect(customerRa).toMatchObject({
    id: raId,
    raNumber: "RA-AS-ORDER-a1-1-1",
    expired: false,
    arrivalDeadlineDateEt: "2026-11-09",
    arrivalDeadlineAt: "2026-11-10T04:59:00.000Z",
    location: { label: "Reno Return Location", phone: "+1 7755550100" },
  });
  expect(customerRa.location.address).toContain("100 Test Way");
  expect(JSON.stringify(customerRa)).not.toContain("Plano");
  expect(JSON.stringify(customerRa)).not.toContain("locationId");
  await expect(
    ra("2026-10-11T12:00:00.000Z").customerRead("other", order.orderId),
  ).rejects.toMatchObject({ status: 404 });
  const email = await db
    .prepare(
      `SELECT m.body FROM quote_conversation_messages m
       JOIN quote_notification_outbox o ON o.message_id=m.id
       WHERE m.request_id=? AND m.body LIKE '%Return Authorization%'`,
    )
    .bind(order.requestId)
    .all<{ body: string }>();
  expect(email.results).toHaveLength(1);
  expect(email.results[0].body).not.toContain("100 Test Way");
  // Quantities cannot be authorized twice while the RA is active.
  await expect(
    issue(order, caseId, "2026-10-12T12:00:00.000Z", {
      lines: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.first,
          physicalQuantity: 1,
        },
      ],
    }),
  ).rejects.toMatchObject({ status: 409 });
});

it("expires at 23:59 ET on day 30 and requires a recorded renewed review to reauthorize", async () => {
  const { order, caseId } = await caseFor("a2");
  const first = await issue(order, caseId, "2026-09-12T15:00:00.000Z");
  const atDeadline = await ra("2026-10-13T03:59:00.000Z").customerRead(
    "buyer",
    order.orderId,
  );
  expect(atDeadline[0]).toMatchObject({
    arrivalDeadlineDateEt: "2026-10-12",
    expired: false,
  });
  const after = await ra("2026-10-13T03:59:00.001Z").customerRead(
    "buyer",
    order.orderId,
  );
  expect(after[0].expired).toBe(true);
  // Expiry closes only the authorization: the Case stays open, no refund exists.
  const [caseView] = await createCaseService(db).adminRead(
    owner,
    order.orderId,
  );
  expect(caseView.status).toBe("open");
  await expect(
    issue(order, caseId, "2026-10-14T12:00:00.000Z"),
  ).rejects.toMatchObject({ status: 400 });
  const second = await issue(order, caseId, "2026-10-14T12:00:00.000Z", {
    previousRaId: first,
    reviewNote: "Customer was travelling; goods still unused per photos",
  });
  const all = await ra("2026-10-14T12:00:00.000Z").adminRead(
    owner,
    order.orderId,
  );
  expect(all.map((item) => [item.id, item.expired])).toEqual([
    [first, true],
    [second, false],
  ]);
  expect(all[1]).toMatchObject({
    previousRaId: first,
    reviewNote: "Customer was travelling; goods still unused per photos",
  });
  await expect(
    db
      .prepare(
        "UPDATE after_sales_return_authorizations SET instructions='x' WHERE id=?",
      )
      .bind(first)
      .run(),
  ).rejects.toThrow(/immutable/);
});

it("declines or closes with customer-visible outcomes in the Case", async () => {
  const { order, caseId } = await caseFor("a3");
  const service = ra("2026-09-13T12:00:00.000Z");
  const decline = {
    orderId: order.orderId,
    caseId,
    expectedVersion: await caseVersion(db, caseId),
    reason: "The photos show the fitting was installed.",
    commandId: crypto.randomUUID(),
  };
  await service.adminDeclineReturn(reviewer, decline);
  await service.adminDeclineReturn(reviewer, decline);
  const cases = createCaseService(db);
  const customer = await cases.customerRead("buyer", order.orderId);
  expect(
    customer.cases[0].events.filter((event) =>
      event.body.startsWith("Return not authorized"),
    ),
  ).toHaveLength(1);
  const [admin] = await cases.adminRead(owner, order.orderId);
  await service.adminCloseCase(reviewer, {
    orderId: order.orderId,
    caseId,
    expectedVersion: admin.version,
    reason: "No further action.",
    commandId: crypto.randomUUID(),
  });
  const closed = await cases.customerRead("buyer", order.orderId);
  expect(closed.cases[0].status).toBe("closed");
  await expect(
    issue(order, caseId, "2026-09-14T12:00:00.000Z"),
  ).rejects.toMatchObject({ status: 409 });
});

it("rejects RA issue and decline made from a stale Case version", async () => {
  const { order, caseId } = await caseFor("a9");
  const current = await caseVersion(db, caseId);
  await expect(
    issue(order, caseId, "2026-09-13T12:00:00.000Z", {
      expectedVersion: current + 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    ra("2026-09-13T12:00:00.000Z").adminDeclineReturn(reviewer, {
      orderId: order.orderId,
      caseId,
      expectedVersion: current - 1,
      reason: "Out of date page",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await issue(order, caseId, "2026-09-13T12:00:00.000Z");
  // Issuing moved the Case forward, so the page's old version is stale.
  await expect(
    ra("2026-09-13T12:00:00.000Z").adminDeclineReturn(reviewer, {
      orderId: order.orderId,
      caseId,
      expectedVersion: current,
      reason: "Too late",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
});
