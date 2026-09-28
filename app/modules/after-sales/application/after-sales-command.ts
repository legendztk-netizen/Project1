import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";

/** Validated, trimmed free text for after-sales commands. */
export function afterSalesText(value: unknown, label: string, maximum = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Response(`${label} required`, { status: 400 });
  return value.trim();
}

/** Optional free text: empty input is recorded as null. */
export function optionalAfterSalesText(value: unknown, label: string) {
  return typeof value === "string" && value.trim()
    ? afterSalesText(value, label)
    : null;
}

/** Client-generated UUID that makes a command idempotent. */
export function afterSalesCommandId(value: unknown) {
  const commandId = afterSalesText(value, "Command ID", 100);
  if (!/^[0-9a-f-]{36}$/i.test(commandId))
    throw new Response("Invalid command ID", { status: 400 });
  return commandId;
}

/** Hash that tells a replay of the same command from a conflicting reuse. */
export const commandHash = (value: string) =>
  piSha256(new TextEncoder().encode(value));
