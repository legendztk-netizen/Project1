import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { AdminIdentity } from "../workers/admin-access";
import { createChinaCalendarService } from "../app/modules/shipment/application/china-calendar-service";

const directory = mkdtempSync(join(tmpdir(), "china-calendar-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const actor: AdminIdentity = {
  id: "calendar-admin",
  email: "calendar-admin@example.test",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};

beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: "wrangler.jsonc",
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
}, 60000);

afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("publishes immutable China calendars with version and command replay", async () => {
  const calendars = createChinaCalendarService(db);
  const first = {
    expectedCurrentVersion: null,
    commandId: crypto.randomUUID(),
    coverageFrom: "2026-09-01",
    coverageThrough: "2026-09-30",
    workingWeekdays: [1, 2, 3, 4, 5],
    exceptions: [
      { date: "2026-09-25", isWorking: false, reason: "Holiday closure" },
      { date: "2026-09-27", isWorking: true, reason: "Replacement workday" },
    ],
    revisionReason: "Reviewed the complete September holiday schedule",
    confirmedComplete: true,
  };
  expect(await calendars.publish(actor, first)).toBe(1);
  expect(await calendars.publish(actor, first)).toBe(1);
  expect(await calendars.read()).toMatchObject({
    version: 1,
    confirmedComplete: true,
    exceptions: { "2026-09-25": false, "2026-09-27": true },
  });
  await expect(
    calendars.publish(actor, { ...first, commandId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await calendars.publish(actor, {
      ...first,
      commandId: crypto.randomUUID(),
      expectedCurrentVersion: 1,
      revisionReason: "Reviewed October coverage and holiday exceptions",
      coverageFrom: "2026-10-01",
      coverageThrough: "2026-10-31",
      exceptions: [],
    }),
  ).toBe(2);
  expect((await calendars.read())?.version).toBe(2);
  expect((await calendars.read(1))?.exceptions["2026-09-25"]).toBe(false);
  await expect(
    db
      .prepare(
        "UPDATE china_fulfillment_calendar_exceptions SET is_working=1 WHERE version=1 AND calendar_date='2026-09-25'",
      )
      .run(),
  ).rejects.toThrow(/immutable/);
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM admin_audit_events WHERE event_type='china_calendar.published'",
      )
      .first("n"),
  ).toBe(2);
});
