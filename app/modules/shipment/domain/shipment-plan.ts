export interface ShipmentPlanLine {
  id: string;
  lineKind: string;
  quantity: number;
  lengthOrder?: { pieceCount?: number } | null;
}

export interface ShipmentGroupAllocation {
  lineId: string;
  physicalQuantity: number;
}

export interface QuotedShipmentGroup {
  id: string;
  label: string;
  allocations: ShipmentGroupAllocation[];
  freightCents: number;
  insuranceCents: number;
  dutiesImportCents: number;
  transportMethod: string;
  incoterm: "DDP" | "DAP";
  namedPlace: string;
}

export interface ShipmentPlanCommercialBasis {
  shipmentMode: "together" | "split";
  shipmentGroups?: QuotedShipmentGroup[];
  transportMethod: string;
  incoterm: "DDP" | "DAP";
  namedPlace: string;
  charges: {
    freight: number;
    insurance: number;
    dutiesImport: number;
  };
}

export function physicalLineQuantity(line: ShipmentPlanLine) {
  const quantity =
    line.lineKind === "length_based_hose"
      ? line.lengthOrder?.pieceCount
      : line.quantity;
  if (!Number.isSafeInteger(quantity) || (quantity ?? 0) <= 0)
    throw new Error(`Physical quantity is required for line ${line.id}`);
  return quantity as number;
}

export function togetherShipmentGroup(
  lines: readonly ShipmentPlanLine[],
  terms: ShipmentPlanCommercialBasis,
): QuotedShipmentGroup {
  return {
    id: "together",
    label: "Ship together",
    allocations: lines.map((line) => ({
      lineId: line.id,
      physicalQuantity: physicalLineQuantity(line),
    })),
    freightCents: terms.charges.freight,
    insuranceCents: terms.charges.insurance,
    dutiesImportCents: terms.charges.dutiesImport,
    transportMethod: terms.transportMethod,
    incoterm: terms.incoterm,
    namedPlace: terms.namedPlace,
  };
}

export function validatedShipmentGroups(
  lines: readonly ShipmentPlanLine[],
  terms: ShipmentPlanCommercialBasis,
): QuotedShipmentGroup[] {
  const groups =
    terms.shipmentGroups ??
    (terms.shipmentMode === "together"
      ? [togetherShipmentGroup(lines, terms)]
      : null);
  if (
    !groups ||
    !Array.isArray(groups) ||
    groups.length < (terms.shipmentMode === "split" ? 2 : 1) ||
    groups.length > 20 ||
    (terms.shipmentMode === "together" && groups.length !== 1)
  )
    throw new Error("Structured shipment groups are required");
  const lineQuantities = new Map(
    lines.map((line) => [line.id, physicalLineQuantity(line)]),
  );
  if (lineQuantities.size !== lines.length || !lines.length)
    throw new Error("Unique accepted Order lines are required");
  const allocated = new Map<string, number>();
  const ids = new Set<string>();
  const normalized = groups.map((group) => {
    if (
      !group ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(group.id) ||
      ids.has(group.id) ||
      !group.label?.trim() ||
      group.label.length > 100 ||
      !Array.isArray(group.allocations) ||
      !group.allocations.length
    )
      throw new Error("Invalid shipment group");
    ids.add(group.id);
    if (
      !group.transportMethod?.trim() ||
      !group.namedPlace?.trim() ||
      group.transportMethod.length > 200 ||
      group.namedPlace.length > 200 ||
      group.incoterm !== terms.incoterm ||
      group.namedPlace.trim() !== terms.namedPlace.trim()
    )
      throw new Error("Shipment terms must match the accepted delivery terms");
    const seen = new Set<string>();
    const allocations = group.allocations.map((allocation) => {
      if (
        !allocation ||
        !lineQuantities.has(allocation.lineId) ||
        seen.has(allocation.lineId) ||
        !Number.isSafeInteger(allocation.physicalQuantity) ||
        allocation.physicalQuantity <= 0
      )
        throw new Error("Invalid shipment allocation");
      seen.add(allocation.lineId);
      allocated.set(
        allocation.lineId,
        (allocated.get(allocation.lineId) ?? 0) + allocation.physicalQuantity,
      );
      return {
        lineId: allocation.lineId,
        physicalQuantity: allocation.physicalQuantity,
      };
    });
    const charges = [
      group.freightCents,
      group.insuranceCents,
      group.dutiesImportCents,
    ];
    if (charges.some((value) => !Number.isSafeInteger(value) || value < 0))
      throw new Error("Invalid shipment charge allocation");
    return {
      id: group.id,
      label: group.label.trim(),
      allocations,
      freightCents: group.freightCents,
      insuranceCents: group.insuranceCents,
      dutiesImportCents: group.dutiesImportCents,
      transportMethod: group.transportMethod.trim(),
      incoterm: group.incoterm,
      namedPlace: group.namedPlace.trim(),
    };
  });
  if (
    [...lineQuantities].some(
      ([lineId, quantity]) => allocated.get(lineId) !== quantity,
    )
  )
    throw new Error(
      "Shipment allocations must exactly cover physical quantities",
    );
  for (const [field, expected] of [
    ["freightCents", terms.charges.freight],
    ["insuranceCents", terms.charges.insurance],
    ["dutiesImportCents", terms.charges.dutiesImport],
  ] as const) {
    if (normalized.reduce((sum, group) => sum + group[field], 0) !== expected)
      throw new Error("Shipment charges must equal the quoted charges");
  }
  return normalized;
}
