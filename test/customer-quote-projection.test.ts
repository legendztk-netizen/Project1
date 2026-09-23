import { describe, expect, it } from "vitest";

import {
  customerQuoteProgressStages,
  customerQuoteProgress,
  customerQuoteProjection,
  type QuoteRequestRecord,
} from "../app/modules/quote-request/domain/quote-request";

describe("customer quote projection", () => {
  it("derives accepted current PI status without advancing payment or orders", () => {
    const record = {
      id: "request",
      referenceNumber: "QR",
      snapshot: null as never,
      submittedAt: "2026-09-21",
      hasCurrentOffer: true,
    };
    expect(customerQuoteProjection(record).progress.code).toBe("RFQ_SUBMITTED");
    expect(
      customerQuoteProjection({
        ...record,
        acceptedCurrentPiQuoteRevisionId: "revision",
      }).progress,
    ).toEqual({ code: "PI_ACCEPTED", label: "PI Accepted" });
    expect(
      customerQuoteProjection({
        ...record,
        acceptedCurrentPiQuoteRevisionId: null,
      }).progress.code,
    ).toBe("RFQ_SUBMITTED");
  });
  it("exposes only the truthful RFQ stage while reserving the agreed lifecycle", () => {
    const record = {
      id: "request-1",
      referenceNumber: "QR-20260821-TEST",
      snapshot: null as never,
      submittedAt: "2026-08-21T12:00:00.000Z",
    } satisfies QuoteRequestRecord;

    expect(customerQuoteProjection(record)).toMatchObject({
      id: "request-1",
      progress: { code: "RFQ_SUBMITTED", label: "RFQ Submitted" },
      referenceNumber: "QR-20260821-TEST",
    });
    expect(customerQuoteProgressStages.map(({ code }) => code)).toEqual([
      "RFQ_SUBMITTED",
      "PI_ISSUED",
      "PI_ACCEPTED",
      "PI_EXPIRED",
      "PI_REPLACEMENT_REQUIRED",
      "PAYMENT_PENDING",
      "PAYMENT_CONFIRMED",
      "PAYMENT_REVIEW_REQUIRED",
      "PAYMENT_REVIEW_HOLD",
      "ORDER_CREATED",
    ]);
    expect(
      customerQuoteProjection({ ...record, hasCurrentOffer: true }).progress,
    ).toEqual({
      code: "RFQ_SUBMITTED",
      label: "RFQ Submitted",
    });
  });

  it("distinguishes issued, expired, accepted and awaiting-replacement PIs", () => {
    const record: QuoteRequestRecord = {
      id: "request",
      referenceNumber: "QR",
      snapshot: null as never,
      submittedAt: "2026-09-21",
      hasCurrentOffer: true,
      currentPi: {
        quoteRevisionId: "r1",
        currentQuoteRevisionId: "r1",
        validUntil: "2026-10-01T00:00:00Z",
        totalCents: 25000,
        currency: "USD",
      },
    };
    expect(customerQuoteProgress(record, Date.parse("2026-09-30"))).toBe(
      "PI_ISSUED",
    );
    expect(customerQuoteProgress(record, Date.parse("2026-10-01"))).toBe(
      "PI_EXPIRED",
    );
    expect(
      customerQuoteProgress(
        { ...record, acceptedCurrentPiQuoteRevisionId: "r1" },
        Date.parse("2026-10-02"),
      ),
    ).toBe("PI_ACCEPTED");
    expect(
      customerQuoteProgress({
        ...record,
        currentPi: { ...record.currentPi!, currentQuoteRevisionId: "r2" },
      }),
    ).toBe("PI_REPLACEMENT_REQUIRED");
  });
});
