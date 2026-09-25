import { expect, it } from "vitest";
import {
  validatedShipmentGroups,
  type ShipmentPlanCommercialBasis,
} from "../app/modules/shipment/domain/shipment-plan";
import { initialEstimatedReadyDate } from "../app/modules/shipment/domain/ready-schedule";

const lines = [{ id: "line-a", lineKind: "standard" as const, quantity: 2 }];
const terms: ShipmentPlanCommercialBasis = {
  shipmentMode: "together",
  transportMethod: "Sea freight",
  incoterm: "DDP",
  namedPlace: "Portland, OR",
  charges: { freight: 500, insurance: 0, dutiesImport: 0 },
};

it("requires a reviewed schedule for each newly quoted shipment", () => {
  expect(() =>
    validatedShipmentGroups(lines, terms, { requireReadySchedule: true }),
  ).toThrow(/ready-date schedule/);
  expect(
    validatedShipmentGroups(
      lines,
      { ...terms, readySchedule: { kind: "china_business_days", days: 10 } },
      { requireReadySchedule: true },
    )[0].readySchedule,
  ).toEqual({ kind: "china_business_days", days: 10 });
});

it("keeps historical shipment groups valid without inventing a date", () => {
  expect(
    validatedShipmentGroups(lines, terms)[0].readySchedule,
  ).toBeUndefined();
});

it("preserves a missed fixed commitment without presenting it as a current estimate", () => {
  const confirmedAt = "2026-09-24T01:00:00.000Z";
  expect(
    initialEstimatedReadyDate(
      "2026-09-23",
      { kind: "fixed_date", readyDate: "2026-09-23" },
      confirmedAt,
    ),
  ).toBeNull();
  expect(
    initialEstimatedReadyDate(
      "2026-09-24",
      { kind: "fixed_date", readyDate: "2026-09-24" },
      confirmedAt,
    ),
  ).toBe("2026-09-24");
});
