// PI acceptance also checks SQLite's real clock. Keep the historical fixture's
// weekdays and relative dates, while issuing its PI within the last two weeks.
const dayMs = 24 * 60 * 60 * 1000;
const historicalMonday = Date.UTC(2026, 8, 14);
const today = new Date();
const utcToday = Date.UTC(
  today.getUTCFullYear(),
  today.getUTCMonth(),
  today.getUTCDate(),
);
const previousMonday =
  utcToday - (((new Date(utcToday).getUTCDay() + 6) % 7) + 7) * dayMs;
const offsetMs = previousMonday - historicalMonday;

export function piFixtureDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new Error(`Invalid fixture date: ${value}`);
  const shifted = new Date(timestamp + offsetMs).toISOString();
  return value.length === 10 ? shifted.slice(0, 10) : shifted;
}
