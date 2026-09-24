import { beforeEach, expect, it, vi } from "vitest";
import { commercialTerms } from "./fixtures/quote-commercial";

const { saveTerms, find } = vi.hoisted(() => ({
  saveTerms: vi.fn(),
  find: vi.fn(),
}));
vi.mock("../app/modules/admin/infrastructure/admin-request-context", () => ({
  requireAdminRequestContext: () => ({ env: { DB: {} }, adminIdentity: {} }),
}));
vi.mock(
  "../app/modules/quote-review/infrastructure/d1-quote-preparation",
  () => ({
    createQuotePreparation: () => ({ saveTerms, find }),
  }),
);
vi.mock("../app/modules/quote-review/domain/private-review", () => ({
  requireReviewMutation: vi.fn(),
  readPrivateReviewForm: (request: Request) => request.formData(),
}));
import { action } from "../app/modules/admin/routes/quote-commercial-terms";

beforeEach(() => {
  saveTerms.mockReset();
  find.mockReset();
  find.mockResolvedValue({ source: { lines: [] } });
});
async function submit(intent: string) {
  const terms = commercialTerms();
  const form = new FormData();
  for (const [key, value] of Object.entries({
    ...terms,
    ...terms.destination,
  })) {
    if (typeof value === "string") form.set(key, value);
    if (value === true) form.set(key, "on");
  }
  for (const [key, value] of Object.entries(terms.charges))
    form.set(key, (value / 100).toFixed(2));
  form.set("version", "3");
  form.set("commandId", "test-command");
  form.set("intent", intent);
  return action({
    request: new Request("http://localhost/admin/quotes/test/terms", {
      method: "POST",
      body: form,
    }),
    params: { requestId: "test" },
    context: {},
  } as unknown as Parameters<typeof action>[0]);
}
it("saves all terms before continuing to issue", async () => {
  const result = await submit("continue");
  expect(saveTerms).toHaveBeenCalledWith(
    "test",
    3,
    commercialTerms(),
    "test-command",
  );
  expect((result as Response).headers.get("Location")).toBe(
    "/admin/quotes/test/issue",
  );
});
it("returns to terms with save confirmation for ordinary save", async () => {
  expect(((await submit("")) as Response).headers.get("Location")).toBe(
    "/admin/quotes/test/terms?saved=1",
  );
});
it("keeps validation and conflict failures on the form instead of redirecting", async () => {
  for (const error of [
    new Error("Invalid terms"),
    new Response("Draft changed", { status: 409 }),
  ]) {
    saveTerms.mockRejectedValueOnce(error);
    const result = await submit("continue");
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toHaveProperty("data.error");
  }
});
