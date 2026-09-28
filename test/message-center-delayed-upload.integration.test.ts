import { afterAll, beforeAll, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createMessageCenter } from "../app/modules/message-center/application/message-center-service";
import {
  owner,
  seedAfterSalesOrder,
  startAfterSalesDatabase,
} from "./fixtures/after-sales-order";

let fixture: Awaited<ReturnType<typeof startAfterSalesDatabase>>;
beforeAll(async () => {
  fixture = await startAfterSalesDatabase("review-message-unread");
}, 90_000);
afterAll(async () => {
  await fixture?.dispose();
});

it("keeps a customer upload unread when it commits after the admin viewed a newer message", async () => {
  const order = await seedAfterSalesOrder(fixture.db, "review-unread");
  let entered!: () => void;
  let release!: () => void;
  const uploading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayedBucket = new Proxy(fixture.bucket, {
    get(target, property) {
      if (property === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          entered();
          await held;
          return target.put(...args);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const attachment = new File(
    [new Uint8Array(await pdf.save())],
    "evidence.pdf",
    { type: "application/pdf" },
  );
  const post = () =>
    new Request("https://shop.test/account/messages/test", {
      method: "POST",
      headers: { Origin: "https://shop.test" },
    });
  const pending = createMessageCenter(fixture.db, delayedBucket)
    .customer("buyer")
    .send({
      request: post(),
      requestId: order.requestId,
      commandId: crypto.randomUUID(),
      body: "Please review my attached evidence",
      attachment,
    });
  await uploading;
  const admin = createMessageCenter(fixture.db, fixture.bucket).admin(owner);
  try {
    await admin.send({
      request: post(),
      requestId: order.requestId,
      commandId: crypto.randomUUID(),
      body: "We are reviewing the order",
    });
    const viewed = await admin.thread(order.requestId);
    expect(
      viewed.messages.messages.some(
        (m) => m.body === "Please review my attached evidence",
      ),
    ).toBe(false);
  } finally {
    release();
  }
  await pending;
  const unread = await admin.unreadThreads();

  expect(unread, "The customer message was never visible to this admin").toBe(
    1,
  );
  const threads = await admin.threads({ filter: "unread", query: "" });
  expect(
    threads.threads.find((thread) => thread.requestId === order.requestId)
      ?.unread,
  ).toBe(1);
  await admin.thread(order.requestId);
  expect(await admin.unreadThreads()).toBe(0);
});
