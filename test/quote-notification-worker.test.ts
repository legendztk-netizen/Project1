import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationBindings } from "../workers/environment";

const mocks = vi.hoisted(() => ({
  factory: vi.fn(),
  dispatch: vi.fn(),
  consume: vi.fn(),
}));
vi.mock("../app/modules/quote-notifications", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../app/modules/quote-notifications")>();
  return { ...original, createQuoteNotifications: mocks.factory };
});
import {
  consumeQuoteNotifications,
  dispatchQuoteNotifications,
  quoteNotifications,
} from "../workers/quote-notifications";

const environment = {
  APP_ENV: "local",
  DB: {},
  ASYNC_JOBS: {},
  EMAIL_DELIVERY_MODE: "stub",
} as ApplicationBindings;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.factory.mockReturnValue({
    dispatch: mocks.dispatch,
    consume: mocks.consume,
  });
});
describe("quote notification Worker wiring", () => {
  it("derives a stable context-bound protection key without storing it in D1", async () => {
    await quoteNotifications(environment);
    const first = mocks.factory.mock.calls[0][0].protector;
    const encrypted = await first.seal("private reply token", "job-1");
    await quoteNotifications(environment);
    const second = mocks.factory.mock.calls[1][0].protector;
    expect(await second.open(encrypted, "job-1")).toBe("private reply token");
    await expect(second.open(encrypted, "job-2")).rejects.toThrow();
    await expect(
      quoteNotifications({ ...environment, APP_ENV: "production" }),
    ).rejects.toThrow();
  });
  it("dispatches the durable outbox through the bound queue", async () => {
    mocks.dispatch.mockResolvedValue({ enqueued: 1, failed: 0 });
    expect(await dispatchQuoteNotifications(environment)).toEqual({
      enqueued: 1,
      failed: 0,
    });
    expect(mocks.dispatch).toHaveBeenCalledWith(environment.ASYNC_JOBS, 100);
  });
  it("keeps frozen payloads decryptable after session-secret rotation", async () => {
    const env = {
      ...environment,
      APP_ENV: "preview",
      PREVIEW_NOTIFICATION_ENCRYPTION_KEY:
        "test-only-persistent-notification-encryption-material",
      PREVIEW_SESSION_SIGNING_KEY: "session-before",
    } as ApplicationBindings;
    await quoteNotifications(env);
    const ciphertext = await mocks.factory.mock.calls[0][0].protector.seal(
      "frozen",
      "job",
    );
    await quoteNotifications({
      ...env,
      PREVIEW_SESSION_SIGNING_KEY: "session-after",
    });
    expect(
      await mocks.factory.mock.calls[1][0].protector.open(ciphertext, "job"),
    ).toBe("frozen");
  });
  it("recovers multiple batches and bounds each sweep", async () => {
    mocks.dispatch
      .mockResolvedValueOnce({ enqueued: 100, failed: 0 })
      .mockResolvedValueOnce({ enqueued: 80, failed: 0 });
    expect(await dispatchQuoteNotifications(environment)).toEqual({
      enqueued: 180,
      failed: 0,
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    mocks.dispatch.mockClear().mockResolvedValue({ enqueued: 100, failed: 0 });
    expect(await dispatchQuoteNotifications(environment)).toEqual({
      enqueued: 500,
      failed: 0,
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(5);
  });
  it("processes each job and does not acknowledge unknown jobs", async () => {
    mocks.consume.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const known = {
      body: { type: "quote-conversation-notification", notificationId: "one" },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const unknown = { body: { type: "unknown" }, ack: vi.fn(), retry: vi.fn() };
    await consumeQuoteNotifications(
      { messages: [known, unknown] } as unknown as MessageBatch<unknown>,
      environment,
    );
    expect(mocks.consume).toHaveBeenCalledTimes(2);
    expect(unknown.ack).not.toHaveBeenCalled();
    expect(unknown.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });
});
