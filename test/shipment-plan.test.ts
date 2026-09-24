import { describe, expect, it } from "vitest";
import {
  physicalLineQuantity,
  togetherShipmentGroup,
  validatedShipmentGroups,
  type ShipmentPlanCommercialBasis,
  type ShipmentPlanLine,
} from "../app/modules/shipment/domain/shipment-plan";

const lines: ShipmentPlanLine[] = [
  { id: "adapter", lineKind: "standard", quantity: 4 },
  {
    id: "cut-hose",
    lineKind: "length_based_hose",
    quantity: 50,
    lengthOrder: { pieceCount: 2 },
  },
];
const terms: ShipmentPlanCommercialBasis = {
  shipmentMode: "together",
  transportMethod: "Sea freight",
  incoterm: "DDP",
  namedPlace: "Portland",
  charges: { freight: 1000, insurance: 200, dutiesImport: 300 },
};

describe("shipment plan", () => {
  it("allocates cut hose by pieces rather than pricing footage", () => {
    expect(physicalLineQuantity(lines[1])).toBe(2);
    expect(togetherShipmentGroup(lines, terms).allocations).toEqual([
      { lineId: "adapter", physicalQuantity: 4 },
      { lineId: "cut-hose", physicalQuantity: 2 },
    ]);
    expect(validatedShipmentGroups(lines, terms)).toHaveLength(1);
  });

  it("accepts an exact split of physical quantities and fixed charges", () => {
    const first = togetherShipmentGroup(lines, terms);
    const second = {
      ...first,
      id: "batch-2",
      label: "Batch 2",
      allocations: [
        { lineId: "adapter", physicalQuantity: 2 },
        { lineId: "cut-hose", physicalQuantity: 1 },
      ],
      freightCents: 400,
      insuranceCents: 100,
      dutiesImportCents: 100,
    };
    const split = {
      ...terms,
      shipmentMode: "split" as const,
      shipmentGroups: [
        {
          ...first,
          id: "batch-1",
          label: "Batch 1",
          allocations: second.allocations,
          freightCents: 600,
          insuranceCents: 100,
          dutiesImportCents: 200,
        },
        second,
      ],
    };
    expect(validatedShipmentGroups(lines, split)).toHaveLength(2);
    expect(() =>
      validatedShipmentGroups(lines, {
        ...split,
        shipmentGroups: [
          split.shipmentGroups[0],
          {
            ...second,
            allocations: [{ lineId: "adapter", physicalQuantity: 3 }],
          },
        ],
      }),
    ).toThrow(/exactly cover/);
    expect(() =>
      validatedShipmentGroups(lines, {
        ...split,
        shipmentGroups: [
          split.shipmentGroups[0],
          { ...second, freightCents: 500 },
        ],
      }),
    ).toThrow(/charges/);
    expect(() =>
      validatedShipmentGroups(lines, {
        ...split,
        shipmentGroups: [
          { ...split.shipmentGroups[0], transportMethod: "Air freight" },
          second,
        ],
      }),
    ).toThrow(/accepted delivery terms/);
  });

  it("rejects ambiguous split plans and missing physical piece counts", () => {
    expect(() =>
      validatedShipmentGroups(lines, { ...terms, shipmentMode: "split" }),
    ).toThrow(/Structured shipment groups/);
    expect(() =>
      physicalLineQuantity({ ...lines[1], lengthOrder: null }),
    ).toThrow(/Physical quantity/);
  });
});
