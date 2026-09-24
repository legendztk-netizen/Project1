import { parseUsdCents } from "../../quote-review/domain/quote-pricing";
import type { QuotedShipmentGroup } from "../domain/shipment-plan";
import { parseReadyScheduleForm } from "./parse-ready-schedule-form";

export function parseShipmentGroupsForm(
  form: FormData,
  lines: readonly { id: string }[],
  terms: {
    incoterm: "DDP" | "DAP";
    namedPlace: string;
  },
  options: { requireReadySchedule?: boolean } = {},
): QuotedShipmentGroup[] {
  const text = (key: string) => String(form.get(key) ?? "");
  const count = Number(text("shipmentGroupCount"));
  if (!Number.isSafeInteger(count) || count < 2 || count > 20)
    throw new Error("Choose between 2 and 20 shipment groups");
  return Array.from({ length: count }, (_, groupIndex) => ({
    id: text(`groupId-${groupIndex}`),
    label: text(`groupLabel-${groupIndex}`),
    allocations: lines.flatMap((line, lineIndex) => {
      const quantity = Number(text(`groupQty-${groupIndex}-${lineIndex}`));
      if (!Number.isSafeInteger(quantity) || quantity < 0)
        throw new Error("Enter whole physical quantities for each batch");
      return quantity > 0
        ? [{ lineId: line.id, physicalQuantity: quantity }]
        : [];
    }),
    freightCents: parseUsdCents(text(`groupFreight-${groupIndex}`)),
    insuranceCents: parseUsdCents(text(`groupInsurance-${groupIndex}`)),
    dutiesImportCents: parseUsdCents(text(`groupDuties-${groupIndex}`)),
    transportMethod: text(`groupTransport-${groupIndex}`),
    incoterm: terms.incoterm,
    namedPlace: terms.namedPlace,
    ...(options.requireReadySchedule
      ? {
          readySchedule: parseReadyScheduleForm(
            form,
            `groupReady-${groupIndex}`,
          ),
        }
      : {}),
  }));
}
