import { describe, expect, it } from "vitest";

import {
  customerQuoteProgressStages,
  customerQuoteProjection,
  type QuoteRequestRecord,
} from "../app/modules/quote-request/domain/quote-request";

describe("customer quote projection", () => {
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
      "QUOTE_READY",
      "PI_ACCEPTED",
      "PAYMENT_PENDING",
      "PAYMENT_CONFIRMED",
      "ORDER_CREATED",
    ]);
    expect(customerQuoteProjection(record, "QUOTE_READY").progress).toEqual({
      code: "QUOTE_READY",
      label: "Quote Ready",
    });
  });
});
