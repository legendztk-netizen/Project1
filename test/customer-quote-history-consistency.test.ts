import { expect, it, vi } from "vitest";
import type { ApplicationBindings } from "../workers/environment";
const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  current: vi.fn(),
  proposed: vi.fn(),
  acceptedRevision: null as string | null,
  list: vi.fn(),
}));
vi.mock(
  "../app/modules/customer-identity/application/customer-account-service",
  () => ({
    createCustomerAccountService: () => ({
      read: async () => ({ profile: { id: "owner" } }),
    }),
  }),
);
vi.mock(
  "../app/modules/quote-list/application/anonymous-quote-list-service",
  () => ({ createAnonymousQuoteListService: () => ({}) }),
);
vi.mock(
  "../app/modules/catalog/infrastructure/d1-public-catalog-repository",
  () => ({ createD1PublicCatalogRepository: () => ({}) }),
);
vi.mock(
  "../app/modules/quote-request/infrastructure/d1-quote-request-repository",
  () => ({
    createD1QuoteRequestRepository: () => ({
      listOwned: mocks.list,
      findOwned: async () => ({
        id: "rfq",
        referenceNumber: "QR-TEST",
        snapshot: {},
        submittedAt: "2026-09-14",
        acceptedCurrentPiQuoteRevisionId: mocks.acceptedRevision,
      }),
    }),
  }),
);
vi.mock(
  "../app/modules/quote-review/infrastructure/d1-quote-revisions",
  () => ({
    createQuoteRevisions: () => ({
      customerHistory: mocks.history,
      customerCurrent: mocks.current,
      customerProposedChanges: mocks.proposed,
    }),
  }),
);
import { createQuoteRequestService } from "../app/modules/quote-request/application/quote-request-service";

it("derives current and previous offers from one history read during concurrent issuance", async () => {
  let latest = 2;
  mocks.current.mockImplementation(async () => ({
    id: `revision-${latest}`,
    revisionNumber: latest,
  }));
  mocks.history.mockImplementation(async () => {
    const captured = [
      { id: "revision-2", revisionNumber: 2 },
      { id: "revision-1", revisionNumber: 1 },
    ];
    latest = 3;
    return captured;
  });
  mocks.proposed.mockResolvedValue([]);
  const result = await createQuoteRequestService({
    DB: {},
  } as ApplicationBindings).readOwned(
    new Request("https://test.invalid/account/quotes/rfq"),
    "rfq",
  );
  expect(result.record?.currentOffer?.revisionNumber).toBe(2);
  expect(
    result.record?.offerHistory?.map((offer) => offer.revisionNumber),
  ).toEqual([2, 1]);
  expect(result.record?.progress.code).toBe("QUOTE_READY");
  expect(mocks.history).toHaveBeenCalledTimes(1);
  expect(mocks.current).not.toHaveBeenCalled();
  expect(mocks.proposed).toHaveBeenCalledWith("owner", "rfq", "revision-2");
});

it("projects list acceptance without fetching per-quote revision histories", async () => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([
    {
      id: "accepted",
      hasCurrentOffer: true,
      acceptedCurrentPiQuoteRevisionId: "revision-2",
    },
    {
      id: "ready",
      hasCurrentOffer: true,
      acceptedCurrentPiQuoteRevisionId: null,
    },
    { id: "submitted", hasCurrentOffer: false },
  ]);
  const result = await createQuoteRequestService({
    DB: {},
  } as ApplicationBindings).listOwned(
    new Request("https://test.invalid/account/quotes"),
  );
  expect(result.records.map((record) => record.progress.code)).toEqual([
    "PI_ACCEPTED",
    "QUOTE_READY",
    "RFQ_SUBMITTED",
  ]);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.history).not.toHaveBeenCalled();
  expect(mocks.current).not.toHaveBeenCalled();
});

it("does not show an old acceptance beside a concurrently replaced quote revision", async () => {
  mocks.acceptedRevision = "revision-2";
  mocks.proposed.mockResolvedValue([]);
  try {
    for (const revision of ["revision-2", "revision-3"]) {
      mocks.history.mockResolvedValue([
        { id: revision, revisionNumber: revision === "revision-2" ? 2 : 3 },
      ]);
      const result = await createQuoteRequestService({
        DB: {},
      } as ApplicationBindings).readOwned(
        new Request("https://test.invalid/account/quotes/rfq"),
        "rfq",
      );
      expect(result.record?.progress.code).toBe(
        revision === "revision-2" ? "PI_ACCEPTED" : "QUOTE_READY",
      );
    }
  } finally {
    mocks.acceptedRevision = null;
  }
});
