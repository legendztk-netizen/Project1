import { describe, expect, it } from "vitest";

import {
  filterAdminQuoteReviews,
  formatBeijingDateTime,
  parseAdminQuoteReviewFilters,
  projectAdminQuoteReview,
} from "../app/modules/quote-review/domain/admin-quote-review";
import { customerQuoteDateTime } from "../app/modules/quote-request/ui/customer-quote-presentation";

function source(
  snapshot: unknown,
  overrides: Partial<{
    id: string;
    referenceNumber: string;
    submittedAt: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "request-1",
    referenceNumber: overrides.referenceNumber ?? "QR-TEST-1",
    snapshot,
    submittedAt: overrides.submittedAt ?? "2026-09-03T03:00:00.000Z",
  };
}

describe("Admin RFQ review projection", () => {
  it("projects customer, purchasing, destination and amount snapshots", () => {
    const review = projectAdminQuoteReview(
      source({
        actor: { email: "buyer@example.com", fullName: "Buyer Name" },
        amounts: { merchandiseSubtotal: 125.5 },
        destination: {
          city: "New York",
          countryCode: "US",
          postalCode: "10001",
          stateProvince: "NY",
        },
        lines: [{ lineKind: "standard" }],
        purchasingContext: { kind: "individual" },
      }),
    );

    expect(review).toMatchObject({
      customerDisplayName: "Buyer Name",
      customerEmail: "buyer@example.com",
      destinationSummary: "New York, NY, 10001, US",
      lineCount: 1,
      merchandiseReferenceAmount: 125.5,
      purchasingContextKind: "individual",
      purchasingContextLabel: "个人采购",
      reviewState: "awaiting_review",
      technicalReview: { reasons: [], state: "not_flagged" },
    });
  });

  it("uses the organization legal name as the queue identity", () => {
    const review = projectAdminQuoteReview(
      source({
        actor: { email: "agent@example.com", fullName: "Primary Contact" },
        lines: [],
        purchasingContext: {
          kind: "organization",
          legalName: "Example Manufacturing LLC",
        },
      }),
    );

    expect(review.customerDisplayName).toBe("Example Manufacturing LLC");
    expect(review.purchasingContextLabel).toBe("Example Manufacturing LLC");
  });

  it("recognizes real Standard Product line shapes without fictional flags", () => {
    const review = projectAdminQuoteReview(
      source({
        lines: [
          { lineKind: "standard", sku: "ADP-1" },
          {
            lengthOrder: { originalLengthUnit: "ft", originalLengthValue: 25 },
            lineKind: "length_based_hose",
            sku: "601R1_004",
          },
        ],
        version: 1,
      }),
    );

    expect(review.technicalReview).toEqual({
      reasons: [],
      state: "not_flagged",
    });
  });

  it("surfaces configured-assembly technical and manual paths", () => {
    const review = projectAdminQuoteReview(
      source({
        lines: [
          {
            configuredAssembly: {
              snapshot: {
                review: {
                  issues: [
                    {
                      kind: "technical_review",
                      message: "Measurement method requires confirmation.",
                    },
                    {
                      code: "MANUAL-1",
                      kind: "manual_path",
                    },
                  ],
                  outcome: "technical_review",
                },
              },
            },
            lineKind: "configured_assembly",
          },
        ],
      }),
    );

    expect(review.technicalReview).toEqual({
      reasons: ["Measurement method requires confirmation.", "MANUAL-1"],
      state: "required",
    });
  });

  it("keeps legacy and malformed snapshots honest instead of inferring clear", () => {
    expect(projectAdminQuoteReview(source(null))).toMatchObject({
      customerDisplayName: null,
      lineCount: null,
      technicalReview: { reasons: [], state: "not_recorded" },
    });
    expect(
      projectAdminQuoteReview(
        source({ lines: [{ lineKind: "unknown_legacy_kind" }], version: 0 }),
      ).technicalReview.state,
    ).toBe("not_recorded");
  });

  it("filters technical states and sorts required reviews first without mutation", () => {
    const input = [
      projectAdminQuoteReview(
        source(
          {
            lines: [{ lineKind: "standard" }],
          },
          {
            id: "clear",
            referenceNumber: "QR-CLEAR",
            submittedAt: "2026-09-03T06:00:00.000Z",
          },
        ),
      ),
      projectAdminQuoteReview(
        source(
          {
            lines: [
              {
                configuredAssembly: {
                  snapshot: {
                    review: {
                      issues: [],
                      outcome: "manual_quote",
                    },
                  },
                },
                lineKind: "configured_assembly",
              },
            ],
          },
          {
            id: "required",
            referenceNumber: "QR-REQUIRED",
            submittedAt: "2026-09-03T04:00:00.000Z",
          },
        ),
      ),
    ];
    const original = structuredClone(input);

    expect(
      filterAdminQuoteReviews(input, {
        reviewState: "all",
        sort: "technical_first",
        technicalReview: "all",
      }).map(({ id }) => id),
    ).toEqual(["required", "clear"]);
    expect(
      filterAdminQuoteReviews(input, {
        reviewState: "all",
        sort: "newest",
        technicalReview: "not_flagged",
      }).map(({ id }) => id),
    ).toEqual(["clear"]);
    expect(input).toEqual(original);
  });

  it("normalizes unsupported filters and formats Admin time in Beijing", () => {
    expect(
      parseAdminQuoteReviewFilters(
        new URL(
          "https://admin.example.com/admin/quotes?technical=bogus&sort=bogus",
        ),
      ),
    ).toEqual({
      reviewState: "all",
      sort: "newest",
      technicalReview: "all",
    });
    expect(formatBeijingDateTime("2026-09-03T03:00:00.000Z")).toBe(
      "2026-09-03 11:00 北京时间",
    );
    expect(
      customerQuoteDateTime.format(new Date("2026-09-03T03:00:00.000Z")),
    ).toBe("Sep 2, 2026, 11:00 PM EDT");
    expect(formatBeijingDateTime("2026-09-02T16:00:00.000Z")).toBe(
      "2026-09-03 00:00 北京时间",
    );
    expect(formatBeijingDateTime("not-a-date")).toBe("时间快照无效");
  });
});
