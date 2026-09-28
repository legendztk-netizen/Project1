import { inspectionConditionKeys } from "./return-inspection-service";

/**
 * Form field names scoped to an Order line and Shipment. Identifiers are
 * percent-encoded because Spec 6 Shipment ids contain ":" (for example
 * `shipment:<orderId>:together`), which would otherwise split the name.
 */
export function scopedField(
  prefix: string,
  lineId: string,
  shipmentId: string | null,
) {
  return `${prefix}:${encodeURIComponent(lineId)}:${encodeURIComponent(shipmentId ?? "")}`;
}

export function readScopedFields(form: FormData, prefix: string) {
  const rows: Array<{
    lineId: string;
    shipmentId: string | null;
    value: string;
  }> = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith(`${prefix}:`)) continue;
    const parts = key.slice(prefix.length + 1).split(":");
    if (parts.length !== 2) continue;
    try {
      rows.push({
        lineId: decodeURIComponent(parts[0]),
        shipmentId: decodeURIComponent(parts[1]) || null,
        value: String(value),
      });
    } catch {
      // Malformed names are ignored; the server rejects missing quantities.
    }
  }
  return rows;
}

/** Positive quantities for fields that always name a Shipment. */
function shipmentQuantities(form: FormData, prefix: string) {
  const lines: Array<{
    lineId: string;
    shipmentId: string;
    physicalQuantity: number;
  }> = [];
  for (const { lineId, shipmentId, value } of readScopedFields(form, prefix)) {
    const physicalQuantity = Number(value);
    if (!value.trim() || physicalQuantity === 0 || !shipmentId) continue;
    lines.push({ lineId, shipmentId, physicalQuantity });
  }
  return lines;
}

/** Admin enters Beijing time (UTC+8, no DST) in datetime-local fields. */
export function beijingLocalToIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? new Date(`${value}:00+08:00`).toISOString()
    : value;
}

export const cancellationQuantityField = (
  lineId: string,
  shipmentId: string | null,
) => scopedField("cancelQty", lineId, shipmentId);

export function readCancellationQuantities(form: FormData) {
  const quantities: Array<{
    lineId: string;
    shipmentId: string | null;
    physicalQuantity: number;
  }> = [];
  for (const { lineId, shipmentId, value } of readScopedFields(
    form,
    "cancelQty",
  )) {
    const physicalQuantity = Number(value);
    if (!value.trim() || physicalQuantity === 0) continue;
    quantities.push({ lineId, shipmentId, physicalQuantity });
  }
  return quantities;
}

export function readCancellationDecisions(form: FormData) {
  return readScopedFields(form, "approve").map(
    ({ lineId, shipmentId, value }) => ({
      lineId,
      shipmentId,
      approvedQuantity: Number(value),
    }),
  );
}

export function readFactoryEvidence(form: FormData) {
  if (!form.has("factoryStatus")) return undefined;
  return {
    status: String(form.get("factoryStatus") ?? ""),
    source: String(form.get("factorySource") ?? ""),
    reviewedAt: beijingLocalToIso(String(form.get("factoryReviewedAt") ?? "")),
    supportReference: String(form.get("factorySupportReference") ?? ""),
    attachmentIds: form.getAll("factoryAttachmentId").map(String),
    externalIdentifiers: String(form.get("factoryExternalIdentifiers") ?? ""),
    precut: form.get("factoryPrecut") === "on" ? true : null,
  };
}

export const readCaseLines = (form: FormData) =>
  shipmentQuantities(form, "caseQty");

export const readRaLines = (form: FormData) =>
  shipmentQuantities(form, "raQty");

export const readReceiptLines = (form: FormData) =>
  shipmentQuantities(form, "receiveQty");

export function readInspectionItems(form: FormData) {
  return readScopedFields(form, "inspectApprove").map(
    ({ lineId, shipmentId, value }) => ({
      lineId,
      shipmentId: shipmentId ?? "",
      approvedQuantity: Number(value),
      conditions: Object.fromEntries(
        inspectionConditionKeys.map((key) => [
          key,
          String(
            form.get(scopedField(`inspect-${key}`, lineId, shipmentId)) ?? "",
          ),
        ]),
      ),
    }),
  );
}

export function readRevisionItems(form: FormData) {
  return readScopedFields(form, "reviseApprove").flatMap(
    ({ lineId, shipmentId, value }) =>
      shipmentId
        ? [{ lineId, shipmentId, approvedQuantity: Number(value) }]
        : [],
  );
}
