import { describe, expect, it } from "vitest";
import {
  actualChinaDate,
  actualHandoffInstant,
  trackingDestination,
  verifiedReadiness,
} from "../app/modules/shipment/domain/shipment-milestones";

describe("shipment milestone rules", () => {
  it("requires every offline readiness verification", () => {
    const complete = {
      specificationsVerified: true,
      quantitiesVerified: true,
      offlinePreparationVerified: true,
      requiredInspectionVerified: true,
    };
    expect(verifiedReadiness(complete)).toEqual(complete);
    expect(() =>
      verifiedReadiness({ ...complete, requiredInspectionVerified: false }),
    ).toThrow();
  });

  it("rejects invalid and future actual dates in China time", () => {
    const now = new Date("2026-09-24T00:30:00.000Z");
    expect(actualChinaDate("2026-09-24", now)).toBe("2026-09-24");
    expect(() => actualChinaDate("2026-09-25", now)).toThrow();
    expect(() => actualChinaDate("2026-02-30", now)).toThrow();
    expect(actualHandoffInstant("2026-09-23T23:00:00Z", now)).toEqual({
      at: "2026-09-23T23:00:00Z",
      date: "2026-09-24",
    });
    expect(() => actualHandoffInstant("2026-09-24T01:00:00Z", now)).toThrow();
  });

  it("links only public HTTPS recognized carrier destinations", () => {
    expect(
      trackingDestination("https://www.ups.com/track?loc=en_US"),
    ).toMatchObject({
      customerUrl: "https://www.ups.com/track?loc=en_US",
    });
    expect(trackingDestination("https://other-carrier.example/track")).toEqual({
      storedUrl: "https://other-carrier.example/track",
      customerUrl: null,
    });
    expect(() => trackingDestination("http://www.ups.com/track")).toThrow();
    expect(() =>
      trackingDestination("https://www.ups.com.evil.test/"),
    ).not.toThrow();
    expect(
      trackingDestination("https://www.ups.com.evil.test/").customerUrl,
    ).toBeNull();
  });
});
