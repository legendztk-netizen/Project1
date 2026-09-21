import { beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider, type ActionFunctionArgs } from "react-router";
import { action as acceptAction } from "../app/modules/admin/routes/pi-email-acceptance";
import {
  action as retryAction,
  loader,
} from "../app/modules/admin/routes/pi-acceptance-copies";
import {
  readPiEmailCommand,
  consumePiAcceptanceCopy,
} from "../workers/pi-email-acceptance";
import type { ApplicationBindings } from "../workers/environment";
import { action as emailPageAction } from "../app/modules/admin/routes/pi-email-acceptance-page";
import { action as copiesPageAction } from "../app/modules/admin/routes/pi-acceptance-copies-page";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  accept: vi.fn(),
  retry: vi.fn(),
  list: vi.fn(),
  capture: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("../app/modules/admin/infrastructure/admin-request-context", () => ({
  requireAdminRequestContext: mocks.context,
}));
vi.mock("../workers/pi-email-acceptance", async (original) => ({
  ...(await original<typeof import("../workers/pi-email-acceptance")>()),
  piEmailAcceptance: async () => ({ accept: mocks.accept }),
  piAcceptanceCopies: async () => ({
    retryAdmin: mocks.retry,
    listAdmin: mocks.list,
    readLocalCapture: mocks.capture,
    reconcileAdmin: mocks.reconcile,
  }),
}));
const actor = { id: "authenticated-admin" };
const request = (body: unknown) =>
  new Request("https://admin.test/admin/accept", {
    method: "POST",
    headers: {
      Origin: "https://admin.test",
      "Content-Type": "application/json",
      "cf-ray": "server-ray",
      "CF-Connecting-IP": "192.0.2.8",
      "User-Agent": "agent-test",
    },
    body: JSON.stringify(body),
  });
const args = (req: Request): ActionFunctionArgs => ({
  request: req,
  url: new URL(req.url),
  pattern: "/admin/accept",
  params: { requestId: "request", piId: "pi" },
  context: new RouterContextProvider(),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockReturnValue({ env: {}, adminIdentity: actor });
  mocks.accept.mockResolvedValue({ status: "PI Accepted" });
  mocks.list.mockResolvedValue({ rows: [], nextCursor: null });
  mocks.capture.mockResolvedValue({ text: "local only" });
});

it("uses authenticated Admin/server evidence and returns a non-cacheable shared projection", async () => {
  const input = {
    requestId: "request",
    piId: "pi",
    actor: { id: "forged" },
    requestEvidence: { requestId: "forged" },
  };
  const req = request(input);
  const response = await acceptAction(args(req));
  expect(mocks.accept).toHaveBeenCalledWith(actor, req, input, {
    requestId: "server-ray",
    ipAddress: "192.0.2.8",
    userAgent: "agent-test",
  });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ status: "PI Accepted" });
});

it("rejects absent Admin context and mismatched URL scope without calling acceptance", async () => {
  mocks.context.mockImplementationOnce(() => {
    throw new Response("Forbidden", { status: 403 });
  });
  await expect(acceptAction(args(request({})))).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    acceptAction(args(request({ piId: "foreign", requestId: "request" }))),
  ).rejects.toMatchObject({ status: 409 });
  expect(mocks.accept).not.toHaveBeenCalled();
});

it("bounds streamed JSON commands without trusting Content-Length", async () => {
  await expect(
    readPiEmailCommand(request({ text: "x".repeat(65536) })),
  ).rejects.toMatchObject({ status: 413 });
  for (const body of [null, [], "text"])
    await expect(readPiEmailCommand(request(body))).rejects.toMatchObject({
      status: 400,
    });
  await expect(
    readPiEmailCommand(
      new Request("https://admin.test", { method: "POST", body: "{}" }),
    ),
  ).rejects.toMatchObject({ status: 415 });
  await expect(
    readPiEmailCommand(
      new Request("https://admin.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    ),
  ).rejects.toMatchObject({ status: 400 });
});

it("exposes review/retry and local captures only through the Admin service", async () => {
  const listArgs = args(
    new Request(
      "https://admin.test/admin/copies?unresolved=true&limit=4&before=cursor",
    ),
  );
  expect((await loader(listArgs)).headers.get("Cache-Control")).toContain(
    "no-store",
  );
  expect(mocks.list).toHaveBeenCalledWith(actor, {
    unresolved: true,
    limit: 4,
    before: "cursor",
  });
  await loader(args(new Request("https://admin.test/admin/copies?capture=id")));
  expect(mocks.capture).toHaveBeenCalledWith(actor, "id");
  const req = request({
    action: "retry",
    acceptanceId: "id",
    reason: "key restored",
  });
  await retryAction(args(req));
  expect(mocks.retry).toHaveBeenCalledWith(actor, req, "id", "key restored");
  await expect(
    retryAction(args(request({ action: "delete", acceptanceId: "id" }))),
  ).rejects.toMatchObject({ status: 400 });
});

it("does not construct copy infrastructure for unrelated queue jobs", async () => {
  expect(
    await consumePiAcceptanceCopy(
      { body: { type: "unrelated" }, ack: vi.fn(), retry: vi.fn() },
      {} as ApplicationBindings,
    ),
  ).toBe(false);
});

function formRequest(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(
    "https://admin.test/admin/quotes/request/pi/pi/email-review",
    { method: "POST", headers: { Origin: "https://admin.test" }, body: form },
  );
}
it("submits the usable email form with exact versions, separate acknowledgements and server identity", async () => {
  const req = formRequest({
    commandId: "command",
    documentVersion: "3",
    snapshotHash: "a".repeat(64),
    sourceMessageId: "message",
    legalName: "Buyer LLC",
    explicitlyConfirmed: "yes",
    generalVersion: "general-3",
    generalConfirmed: "yes",
    cancellationVersion: "cancel-3",
    lines: JSON.stringify([{ lineId: "line-1", version: "spec-3" }]),
    "specification-0": "yes",
    "cancellation-0": "yes",
    piReferenceExcerpt: "PI-61",
    generalExcerpt: "Accepted terms",
    "specificationExcerpt-0": "Accepted specifications",
    "cancellationExcerpt-0": "Accepted cancellation",
  });
  const response = await emailPageAction(args(req));
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(302);
  expect(mocks.accept.mock.calls[0][0]).toBe(actor);
  expect(mocks.accept.mock.calls[0][2]).toMatchObject({
    piId: "pi",
    requestId: "request",
    documentVersion: 3,
    legalName: "Buyer LLC",
    explicitlyConfirmed: true,
    acknowledgements: {
      madeToOrder: [
        {
          lineIds: ["line-1"],
          specificationsConfirmed: true,
          cancellationConfirmed: true,
        },
      ],
    },
    review: {
      madeToOrder: [
        {
          lineIds: ["line-1"],
          specificationExcerpt: "Accepted specifications",
          cancellationExcerpt: "Accepted cancellation",
        },
      ],
    },
  });
});

it("submits explicit provider reconciliation from the Admin page and JSON API", async () => {
  const command = {
    commandId: "command",
    acceptanceId: "accepted",
    generation: "2",
    outcome: "confirmed_not_delivered",
    reference: "provider-ticket",
    reason: "No delivery confirmed",
    explicitlyConfirmed: "yes",
  };
  const req = formRequest({ ...command, intent: "reconcile" });
  expect(((await copiesPageAction(args(req))) as Response).status).toBe(302);
  expect(mocks.reconcile).toHaveBeenCalledWith(
    actor,
    req,
    expect.objectContaining({
      generation: 2,
      outcome: "confirmed_not_delivered",
      reference: "provider-ticket",
      explicitlyConfirmed: true,
    }),
  );
  await retryAction(
    args(
      request({
        ...command,
        action: "reconcile",
        generation: 2,
        explicitlyConfirmed: true,
      }),
    ),
  );
  expect(mocks.reconcile).toHaveBeenCalledTimes(2);
});
