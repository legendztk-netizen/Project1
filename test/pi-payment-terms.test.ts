import { describe, expect, it } from "vitest";
import {
  acceptedPaymentDeadline,
  defaultPaymentDueDate,
  dueDateInstant,
  isUsBankBusinessDay,
  paymentTerms,
} from "../app/modules/proforma-invoice/domain/pi-payment-terms";

describe("PI payment terms", () => {
  it("excludes weekends, observed US bank holidays and the acceptance day", () => {
    expect(isUsBankBusinessDay("2026-09-07")).toBe(false);
    expect(isUsBankBusinessDay("2026-09-08")).toBe(true);
    expect(defaultPaymentDueDate("2026-09-04T13:00:00.000Z")).toBe(
      "2026-09-21",
    );
  });

  it("uses the acceptance event's ET date, not the UTC date", () => {
    expect(defaultPaymentDueDate("2026-11-02T03:30:00.000Z")).toBe(
      "2026-11-16",
    );
  });

  it("freezes 23:59 ET across daylight-saving changes", () => {
    expect(dueDateInstant("2026-03-09")).toBe("2026-03-10T03:59:00.000Z");
    expect(dueDateInstant("2026-11-02")).toBe("2026-11-03T04:59:00.000Z");
  });

  it("keeps the relative term until acceptance and rejects an early fixed date", () => {
    const terms = paymentTerms(undefined, "2026-09-14T00:00:00.000Z");
    expect(terms.kind).toBe("ten_us_business_days");
    expect(
      acceptedPaymentDeadline(terms, "2026-09-04T13:00:00.000Z").dueDateEt,
    ).toBe("2026-09-21");
    expect(() =>
      paymentTerms("2026-09-12", "2026-09-14T00:00:00.000Z"),
    ).toThrow();
    expect(paymentTerms("2026-09-14", "2026-09-14T00:00:00.000Z").kind).toBe(
      "fixed_et_date",
    );
  });

  it("refuses to extrapolate beyond maintained calendar coverage", () => {
    expect(() => defaultPaymentDueDate("2035-12-20T00:00:00.000Z")).toThrow(
      /coverage/,
    );
  });
});
