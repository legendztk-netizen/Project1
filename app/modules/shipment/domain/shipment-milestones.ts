import { Temporal } from "@js-temporal/polyfill";

export type ShipmentMilestone = "ready_to_ship" | "shipped" | "delivered";

export interface ReadinessVerification {
  specificationsVerified: boolean;
  quantitiesVerified: boolean;
  offlinePreparationVerified: boolean;
  requiredInspectionVerified: boolean;
}

const trackingHosts = [
  "ups.com",
  "fedex.com",
  "dhl.com",
  "usps.com",
  "sf-express.com",
  "yunexpress.com",
];

export function verifiedReadiness(input: ReadinessVerification) {
  if (
    input.specificationsVerified !== true ||
    input.quantitiesVerified !== true ||
    input.offlinePreparationVerified !== true ||
    input.requiredInspectionVerified !== true
  )
    throw new Response(
      "Verify specifications, quantities, offline preparation, and required inspection",
      { status: 400 },
    );
  return input;
}

export function actualChinaDate(value: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Response("A valid actual date is required", { status: 400 });
  let date: Temporal.PlainDate;
  try {
    date = Temporal.PlainDate.from(value);
  } catch {
    throw new Response("A valid actual date is required", { status: 400 });
  }
  if (date.toString() !== value)
    throw new Response("A valid actual date is required", { status: 400 });
  const today = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO("Asia/Shanghai")
    .toPlainDate();
  if (Temporal.PlainDate.compare(date, today) > 0)
    throw new Response("An actual date cannot be in the future", {
      status: 400,
    });
  return value;
}

export function actualHandoffInstant(value: string, now = new Date()) {
  let instant: Temporal.Instant;
  try {
    instant = Temporal.Instant.from(value);
  } catch {
    throw new Response("A valid carrier handoff time is required", {
      status: 400,
    });
  }
  if (
    Temporal.Instant.compare(
      instant,
      Temporal.Instant.from(now.toISOString()),
    ) > 0
  )
    throw new Response("Carrier handoff cannot be in the future", {
      status: 400,
    });
  return {
    at: instant.toString(),
    date: instant.toZonedDateTimeISO("Asia/Shanghai").toPlainDate().toString(),
  };
}

export function reviewedText(value: string, label: string) {
  const text = value.trim();
  if (!text || text.length > 2000)
    throw new Response(`${label} is required`, { status: 400 });
  return text;
}

export function trackingDestination(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return { storedUrl: null, customerUrl: null };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Response("Invalid tracking URL", { status: 400 });
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    !url.hostname.includes(".")
  )
    throw new Response("Tracking URL must be a public HTTPS address", {
      status: 400,
    });
  const host = url.hostname.toLowerCase();
  const recognized = trackingHosts.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
  return {
    storedUrl: url.toString(),
    customerUrl: recognized ? url.toString() : null,
  };
}
