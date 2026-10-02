import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  receive: vi.fn(),
  verifier: vi.fn(),
}));
vi.mock("../workers/environment", () => ({
  validateRuntimeEnvironment: mocks.validate,
}));
vi.mock("../workers/quote-inbound-email", () => ({
  dispatchInboundEmail: vi.fn(),
  quoteInboundEmail: vi.fn(),
  receiveQuoteEmailEvent: vi.fn(),
  receiveRoutedQuoteEmail: mocks.receive,
}));
vi.mock("../workers/inbound-email-verifier", () => ({
  createInboundEmailVerifier: () => mocks.verifier,
}));
vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  createRequestHandler: () => vi.fn(),
}));
import { InboundEmail } from "../workers/app";

const env = { APP_ENV: "preview" } as CloudflareBindings;
const envelope = {
  from: "customer@example.com",
  to: "r-token@reply-preview.customhoseco.com",
  rawSize: 3,
  headers: [] as Array<[string, string]>,
};
beforeEach(() => vi.clearAllMocks());

it("receives relayed email with this Worker's bindings and the platform verifier", async () => {
  const raw = new ReadableStream<Uint8Array>();
  mocks.receive.mockResolvedValue({ accepted: true });
  const entrypoint = new InboundEmail({} as ExecutionContext, env);
  expect(await entrypoint.receive(envelope, raw)).toEqual({ accepted: true });
  expect(mocks.validate).toHaveBeenCalledWith(env);
  expect(mocks.receive).toHaveBeenCalledWith(
    envelope,
    raw,
    env,
    mocks.verifier,
  );
});

it("fails the call before receiving when the runtime configuration is invalid", async () => {
  mocks.validate.mockImplementation(() => {
    throw new Error("Invalid runtime configuration");
  });
  await expect(
    new InboundEmail({} as ExecutionContext, env).receive(
      envelope,
      new ReadableStream<Uint8Array>(),
    ),
  ).rejects.toThrow("Invalid runtime configuration");
  expect(mocks.receive).not.toHaveBeenCalled();
});
