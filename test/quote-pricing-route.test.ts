import { expect, it, vi } from "vitest";
const { savePrices, start } = vi.hoisted(() => ({
  savePrices: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../app/modules/admin/infrastructure/admin-request-context", () => ({
  requireAdminRequestContext: () => ({ env: { DB: {} }, adminIdentity: {} }),
}));
vi.mock(
  "../app/modules/quote-review/infrastructure/d1-quote-preparation",
  () => ({
    createQuotePreparation: () => ({
      find: async () => ({ source: { lines: [{}] } }),
      savePrices,
      start,
    }),
  }),
);
import { action } from "../app/modules/admin/routes/quote-pricing";
it("starts or reuses the draft from the snapshot and redirects directly to pricing", async () => {
  const form = new FormData();
  form.set("intent", "start");
  const result = await action({
    request: new Request("http://localhost/admin/quotes/test/pricing", {
      method: "POST",
      headers: { Origin: "http://localhost" },
      body: form,
    }),
    params: { requestId: "test" },
    context: {},
  } as unknown as Parameters<typeof action>[0]);
  expect(start).toHaveBeenCalledWith("test");
  expect((result as Response).headers.get("Location")).toBe(
    "/admin/quotes/test/pricing",
  );
});
it("stores the entered final price without applying a submitted comparison discount again", async () => {
  const form = new FormData();
  Object.entries({
    intent: "prices",
    version: "2",
    commandId: "test",
    reason: "Final quote",
    "price-0": "2.00",
    "discount-0": "11.50",
  }).forEach(([key, value]) => form.set(key, value));
  await action({
    request: new Request("http://localhost/admin/quotes/test/pricing", {
      method: "POST",
      headers: { Origin: "http://localhost" },
      body: form,
    }),
    params: { requestId: "test" },
    context: {},
  } as unknown as Parameters<typeof action>[0]);
  expect(savePrices).toHaveBeenCalledWith(
    "test",
    2,
    [{ unitPriceCents: 200, discountBasisPoints: 0 }],
    "Final quote",
    "test",
  );
});
