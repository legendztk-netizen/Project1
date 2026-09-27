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
