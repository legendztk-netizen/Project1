import { beforeEach, expect, it, vi } from "vitest";
import type { ApplicationBindings } from "../workers/environment";

const mocks = vi.hoisted(() => ({
  factory: vi.fn(),
  receive: vi.fn(),
  dispatch: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("../app/modules/quote-inbound-email", () => ({
  createQuoteInboundEmail: mocks.factory,
}));
vi.mock("../workers/quote-notifications", () => ({
  quoteNotifications: async () => ({ resolveReplyToken: mocks.resolve }),
  notificationProtector: async () => ({ seal: vi.fn(), open: vi.fn() }),
}));
import {
  dispatchInboundEmail,
  quoteInboundEmail,
  receiveQuoteEmail,
  receiveQuoteEmailEvent,
} from "../workers/quote-inbound-email";

const env = {
  APP_ENV: "local",
  DB: {},
  PRIVATE_FILES: {},
  ASYNC_JOBS: {},
} as ApplicationBindings;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.factory.mockReturnValue({
    receive: mocks.receive,
    dispatch: mocks.dispatch,
  });
});
it("uses the private bindings, current token ownership resolver, and trusted verifier dependency", async () => {
  const verifier = vi.fn();
  await quoteInboundEmail(env, verifier);
  expect(mocks.factory).toHaveBeenCalledWith(
    expect.objectContaining({
      database: env.DB,
      bucket: env.PRIVATE_FILES,
      resolveReplyToken: mocks.resolve,
      verifyPlatformEmail: verifier,
    }),
  );
});
it("persists the receipt before dispatching its durable job", async () => {
  const message = {
    from: "customer@example.com",
    to: "reply@local.invalid",
    rawSize: 0,
    raw: new ReadableStream<Uint8Array>(),
    headers: new Headers(),
  };
  const receipt = { receiptId: "receipt", state: "pending" };
  mocks.receive.mockResolvedValue(receipt);
  expect(await receiveQuoteEmail(message, env, vi.fn())).toBe(receipt);
  expect(mocks.receive).toHaveBeenCalledWith(message);
  expect(mocks.dispatch).toHaveBeenCalledWith(env.ASYNC_JOBS);
  expect(mocks.receive.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.dispatch.mock.invocationCallOrder[0],
  );
});
it("bounds recovery sweeps to five batches", async () => {
  mocks.dispatch.mockResolvedValue({ enqueued: 100, failed: 0 });
  expect(await dispatchInboundEmail(env)).toEqual({ enqueued: 500, failed: 0 });
  expect(mocks.dispatch).toHaveBeenCalledTimes(5);
});

it("explicitly rejects a receive failure without exposing internal errors or claiming delivery", async () => {
  const message = {
    from: "customer@example.com",
    to: "reply@local.invalid",
    rawSize: 0,
    raw: new ReadableStream<Uint8Array>(),
    headers: new Headers(),
    setReject: vi.fn(),
  };
  mocks.receive.mockRejectedValue(new Error("private infrastructure failure"));
  await receiveQuoteEmailEvent(message, env, vi.fn());
  expect(message.setReject).toHaveBeenCalledWith(
    expect.stringContaining("resend later"),
  );
  expect(message.setReject.mock.calls[0][0]).not.toContain(
    "private infrastructure",
  );
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
