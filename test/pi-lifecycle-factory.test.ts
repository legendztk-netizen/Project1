import { beforeEach, expect, it, vi } from "vitest";
import type { ApplicationBindings } from "../workers/environment";
import { piPdfJobs, piLifecycle } from "../workers/proforma-invoice";

const mocks = vi.hoisted(() => ({
  baseRender: vi.fn(),
  replacementRender: vi.fn(),
  first: vi.fn(),
  bind: vi.fn(),
  prepare: vi.fn(),
  createLifecycle: vi.fn(),
  createJobs: vi.fn(),
}));
vi.mock(
  "../app/modules/proforma-invoice/application/proforma-invoice-service",
  () => ({
    createProformaInvoiceService: () => ({ renderReserved: mocks.baseRender }),
  }),
);
vi.mock(
  "../app/modules/proforma-invoice/application/pi-lifecycle-service",
  () => ({ createPiLifecycleService: mocks.createLifecycle }),
);
vi.mock("../app/modules/proforma-invoice/application/pi-pdf-jobs", () => ({
  createPiPdfJobs: mocks.createJobs,
}));
const env = {
  DB: { prepare: mocks.prepare },
  PRIVATE_FILES: {},
  ASYNC_JOBS: {},
} as unknown as ApplicationBindings;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.prepare.mockReturnValue({ bind: mocks.bind });
  mocks.bind.mockReturnValue({ first: mocks.first });
  mocks.createLifecycle.mockReturnValue({
    renderReserved: mocks.replacementRender,
  });
  mocks.createJobs.mockImplementation((_db, _queue, callback) => ({
    consume: callback,
  }));
});
it.each([true, false])(
  "routes durable PDF consumption by replacement intent membership (%s)",
  async (replacement) => {
    mocks.first.mockResolvedValue(
      replacement ? { pi_id: "replacement-pi" } : null,
    );
    const jobs = piPdfJobs(env);
    await jobs.consume("exact-command-id");
    expect(mocks.bind).toHaveBeenCalledWith("exact-command-id");
    expect(
      replacement ? mocks.replacementRender : mocks.baseRender,
    ).toHaveBeenCalledWith("exact-command-id");
    expect(
      replacement ? mocks.baseRender : mocks.replacementRender,
    ).not.toHaveBeenCalled();
  },
);
it("never falls back to ordinary issuance after replacement rendering fails", async () => {
  mocks.first.mockResolvedValue({ pi_id: "replacement-pi" });
  mocks.replacementRender.mockRejectedValue(new Error("Stale replacement"));
  await expect(piPdfJobs(env).consume("replacement-command")).rejects.toThrow(
    "Stale replacement",
  );
  expect(mocks.baseRender).not.toHaveBeenCalled();
});
it("keeps the lifecycle factory fail-closed without configured font assets", async () => {
  piLifecycle(env);
  const options = mocks.createLifecycle.mock.calls[0][2];
  expect(typeof options.conditions).toBe("function");
  await expect(options.renderPdf({})).rejects.toMatchObject({ status: 503 });
});
