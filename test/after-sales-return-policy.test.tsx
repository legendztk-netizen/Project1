// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import {
  businessDayDeadline,
  convenienceReturnCutoff,
  convenienceReturnCutoffForDate,
  customerTermsAllowed,
  convenienceReturnOpen,
  inspectionDeadline,
  LAUNCH_RETURN_POLICY,
  physicalQuantity,
  raArrivalDeadline,
  refundInitiationDeadline,
  returnProductClass,
  allowsConvenienceReturn,
} from "../app/modules/after-sales/domain/return-policy";
import { conditionsForQuote } from "../app/modules/proforma-invoice/domain/pi-policy";
import ReturnsPolicy from "../app/modules/storefront/routes/returns-policy";
import type { QuoteRevisionSnapshot } from "../app/modules/quote-review/domain/quote-revision";

afterEach(cleanup);

describe("single launch return policy", () => {
  it("uses one 14-day, 10% policy without a legacy version", () => {
    expect(LAUNCH_RETURN_POLICY).toMatchObject({
      requestWindowCalendarDays: 14,
      restockingFeeBasisPoints: 1000,
      raArrivalCalendarDays: 30,
      inspectionBusinessDays: 5,
      refundInitiationBusinessDays: 10,
    });
    const conditions = conditionsForQuote({
      source: { lines: [] },
    } as unknown as QuoteRevisionSnapshot);
    expect(conditions.refund.version).toBe("pi-refund-2026-09-27-v2");
    expect(conditions.refund.text).toContain(
      "a reported problem was caused by the buyer",
    );
    expect(conditions.refund.text).toContain("14 calendar days");
    expect(conditions.refund.text).toContain("10% restocking fee");
    expect(conditions.refund.text).not.toContain("No restocking fee");
  });

  it("treats the ET delivery date as day 0 and closes at 23:59 ET on day 14", () => {
    // Delivered 23:30 ET on Sep 1 (03:30 UTC Sep 2): day 0 is Sep 1.
    const deliveredAt = "2026-09-02T03:30:00.000Z";
    const cutoff = convenienceReturnCutoff(deliveredAt);
    expect(cutoff.dateEt).toBe("2026-09-15");
    expect(cutoff.at).toBe("2026-09-16T03:59:00.000Z");
    expect(convenienceReturnOpen(deliveredAt, "2026-09-16T03:58:59.999Z")).toBe(
      true,
    );
    expect(convenienceReturnOpen(deliveredAt, "2026-09-16T03:59:00.000Z")).toBe(
      true,
    );
    expect(convenienceReturnOpen(deliveredAt, "2026-09-16T03:59:00.001Z")).toBe(
      false,
    );
  });

  it("keeps the ET cutoff correct across the DST change", () => {
    // Delivered Oct 25 2026 (EDT); cutoff Nov 8 is after DST ends (EST).
    const cutoff = convenienceReturnCutoff("2026-10-25T16:00:00.000Z");
    expect(cutoff.dateEt).toBe("2026-11-08");
    expect(cutoff.at).toBe("2026-11-09T04:59:00.000Z");
    const ra = raArrivalDeadline("2026-10-10T14:00:00.000Z");
    expect(ra.dateEt).toBe("2026-11-09");
    expect(ra.at).toBe("2026-11-10T04:59:00.000Z");
  });

  it("counts US business days from the next eligible day, skipping holidays", () => {
    // Received Wed Nov 25 2026; Thanksgiving Nov 26 is skipped.
    expect(inspectionDeadline("2026-11-25T15:00:00.000Z").dateEt).toBe(
      "2026-12-03",
    );
    // Approved Fri Dec 18 2026; Christmas and New Year holidays are skipped.
    const refund = refundInitiationDeadline("2026-12-18T15:00:00.000Z");
    expect(refund.dateEt).toBe("2027-01-05");
    expect(refund.calendarVersion).toBe(
      LAUNCH_RETURN_POLICY.businessCalendarVersion,
    );
    expect(() =>
      businessDayDeadline("2026-12-18T15:00:00.000Z", 5, "unknown"),
    ).toThrow("Unsupported US Business Calendar version");
    expect(() => inspectionDeadline("2035-12-28T15:00:00.000Z")).toThrow(
      "US bank calendar coverage unavailable",
    );
  });

  it("classifies eligibility from frozen Order facts only", () => {
    expect(
      returnProductClass({ lineKind: "standard", madeToOrder: false }),
    ).toBe("standard");
    expect(
      returnProductClass({ lineKind: "standard", madeToOrder: true }),
    ).toBe("made_to_order");
    expect(returnProductClass({ lineKind: "standard" }, true)).toBe(
      "made_to_order",
    );
    expect(returnProductClass({ lineKind: "length_based_hose" })).toBe(
      "cut_hose",
    );
    expect(returnProductClass({ lineKind: "configured_assembly" })).toBe(
      "made_to_order",
    );
    expect(allowsConvenienceReturn("standard")).toBe(true);
    expect(allowsConvenienceReturn("cut_hose")).toBe(false);
    expect(allowsConvenienceReturn("made_to_order")).toBe(false);
    expect(
      physicalQuantity({
        lineKind: "length_based_hose",
        quantity: 120,
        lengthOrder: { pieceCount: 4 },
      }),
    ).toBe(4);
    expect(() => physicalQuantity({ lineKind: "standard" })).toThrow();
  });

  it("publishes the complete policy without disclosing a return address", async () => {
    const router = createMemoryRouter(
      [
        {
          element: <Outlet />,
          id: "root",
          loader: () => ({ customer: null }),
          path: "/",
          children: [{ element: <ReturnsPolicy />, path: "policies/returns" }],
        },
      ],
      { initialEntries: ["/policies/returns"] },
    );
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole("heading", { name: "Returns and Refunds" }),
    ).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain("11:59 PM ET on day 14");
    expect(text).toContain("10% restocking fee");
    expect(text).toContain("not eligible for convenience return");
    expect(text).not.toMatch(/Plano|Haggard|\d{5}(-\d{4})?\b/);
  });

  it("keeps request, RA arrival and inspection deadlines exact on both 2026 DST switch dates", () => {
    // Spring forward (8 Mar): 01:30 EST is still 8 Mar ET; day 30 closes in EDT.
    expect(raArrivalDeadline("2026-03-08T06:30:00.000Z")).toEqual({
      dateEt: "2026-04-07",
      at: "2026-04-08T03:59:00.000Z",
    });
    expect(convenienceReturnCutoffForDate("2026-02-25")).toEqual({
      dateEt: "2026-03-11",
      at: "2026-03-12T03:59:00.000Z",
    });
    // Fall back (1 Nov): 01:30 EDT on 1 Nov is day 0; the cutoff is in EST.
    expect(raArrivalDeadline("2026-11-01T05:30:00.000Z")).toEqual({
      dateEt: "2026-12-01",
      at: "2026-12-02T04:59:00.000Z",
    });
    expect(convenienceReturnCutoffForDate("2026-10-20")).toEqual({
      dateEt: "2026-11-03",
      at: "2026-11-04T04:59:00.000Z",
    });
    expect(
      convenienceReturnOpen(
        "2026-10-20T16:00:00.000Z",
        "2026-11-04T04:59:00.000Z",
      ),
    ).toBe(true);
    expect(
      convenienceReturnOpen(
        "2026-10-20T16:00:00.000Z",
        "2026-11-04T05:00:00.000Z",
      ),
    ).toBe(false);
    // Five business days across the fall-back weekend.
    expect(inspectionDeadline("2026-10-29T15:00:00.000Z")).toMatchObject({
      dateEt: "2026-11-05",
      at: "2026-11-06T04:59:00.000Z",
    });
  });

  it("applies customer terms to an Other problem only under refund terms v2 or later", () => {
    expect(customerTermsAllowed("convenience_return", null)).toBe(true);
    expect(customerTermsAllowed("other", "pi-refund-2026-09-27-v1")).toBe(
      false,
    );
    expect(customerTermsAllowed("other", "pi-refund-2026-09-27-v2")).toBe(true);
    expect(customerTermsAllowed("other", "pi-refund-2026-09-27-v3")).toBe(true);
    expect(customerTermsAllowed("other", "pi-refund-2026-10-05-v1")).toBe(true);
    expect(customerTermsAllowed("other", "pi-refund-2026-09-20-v9")).toBe(
      false,
    );
    expect(customerTermsAllowed("other", "unknown")).toBe(false);
    expect(customerTermsAllowed("other", null)).toBe(false);
    expect(customerTermsAllowed("damaged", "pi-refund-2026-09-27-v2")).toBe(
      false,
    );
  });
});
