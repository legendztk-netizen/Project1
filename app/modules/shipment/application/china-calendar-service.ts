import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import {
  validatedChinaCalendarDraft,
  type ChinaCalendarDraft,
  type ChinaFulfillmentCalendar,
} from "../domain/ready-schedule";

interface CalendarRow {
  version: number;
  status: "draft" | "current" | "superseded";
  coverage_from: string;
  coverage_through: string;
  working_weekdays_json: string;
}

interface ExceptionRow {
  calendar_date: string;
  is_working: number;
}

function assertAdmin(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}

export function createChinaCalendarService(
  db: D1Database,
  options: { auditIp?: string | null } = {},
) {
  const read = async (
    version?: number,
  ): Promise<ChinaFulfillmentCalendar | null> => {
    const row = await db
      .prepare(
        version === undefined
          ? "SELECT * FROM china_fulfillment_calendar_versions WHERE status='current'"
          : "SELECT * FROM china_fulfillment_calendar_versions WHERE version=? AND status!='draft'",
      )
      .bind(...(version === undefined ? [] : [version]))
      .first<CalendarRow>();
    if (!row) return null;
    const exceptions = (
      await db
        .prepare(
          "SELECT calendar_date,is_working FROM china_fulfillment_calendar_exceptions WHERE version=? ORDER BY calendar_date",
        )
        .bind(row.version)
        .all<ExceptionRow>()
    ).results;
    return {
      version: row.version,
      coverageFrom: row.coverage_from,
      coverageThrough: row.coverage_through,
      confirmedComplete: true,
      workingWeekdays: JSON.parse(row.working_weekdays_json) as number[],
      exceptions: Object.fromEntries(
        exceptions.map((item) => [item.calendar_date, item.is_working === 1]),
      ),
    };
  };

  return {
    read,
    async adminRead(actor: AdminIdentity) {
      assertAdmin(actor);
      return read();
    },
    async adminDetails(actor: AdminIdentity) {
      assertAdmin(actor);
      const calendar = await read();
      if (!calendar) return { calendar: null, exceptions: [] };
      const exceptions = (
        await db
          .prepare(
            `SELECT calendar_date,is_working,reason
             FROM china_fulfillment_calendar_exceptions
             WHERE version=? ORDER BY calendar_date`,
          )
          .bind(calendar.version)
          .all<{ calendar_date: string; is_working: number; reason: string }>()
      ).results.map((row) => ({
        date: row.calendar_date,
        isWorking: row.is_working === 1,
        reason: row.reason,
      }));
      return { calendar, exceptions };
    },
    async publish(
      actor: AdminIdentity,
      input: ChinaCalendarDraft & {
        expectedCurrentVersion: number | null;
        commandId: string;
      },
    ) {
      assertAdmin(actor);
      if (!/^[0-9a-f-]{36}$/.test(input.commandId))
        throw new Response("Command identity required", { status: 400 });
      if (
        input.expectedCurrentVersion !== null &&
        (!Number.isSafeInteger(input.expectedCurrentVersion) ||
          input.expectedCurrentVersion < 1)
      )
        throw new Response("Invalid calendar version", { status: 400 });
      const draft = validatedChinaCalendarDraft(input);
      const payloadHash = await piSha256(
        new TextEncoder().encode(
          JSON.stringify({
            ...draft,
            expectedCurrentVersion: input.expectedCurrentVersion,
          }),
        ),
      );
      const replay = async () => {
        const receipt = await db
          .prepare(
            "SELECT actor_id,payload_hash,resulting_version FROM china_fulfillment_calendar_commands WHERE id=?",
          )
          .bind(input.commandId)
          .first<{
            actor_id: string;
            payload_hash: string;
            resulting_version: number;
          }>();
        if (!receipt) return null;
        if (
          receipt.actor_id !== actor.id ||
          receipt.payload_hash !== payloadHash
        )
          throw new Response("Command identity conflict", { status: 409 });
        return receipt.resulting_version;
      };
      const prior = await replay();
      if (prior !== null) return prior;
      const before = await this.adminDetails(actor);
      const next = await db
        .prepare(
          "SELECT coalesce(max(version),0)+1 AS version FROM china_fulfillment_calendar_versions",
        )
        .first<{ version: number }>();
      const version = next?.version ?? 1;
      const now = new Date().toISOString();
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO china_fulfillment_calendar_versions
               (version,status,coverage_from,coverage_through,working_weekdays_json,
                 revision_reason,created_by,created_at)
               SELECT ?,'draft',?,?,?,?,?,?
               WHERE coalesce((SELECT version FROM china_fulfillment_calendar_versions
                 WHERE status='current'),0)=?`,
            )
            .bind(
              version,
              draft.coverageFrom,
              draft.coverageThrough,
              JSON.stringify(draft.workingWeekdays),
              draft.revisionReason,
              actor.id,
              now,
              input.expectedCurrentVersion ?? 0,
            ),
          db
            .prepare(
              `INSERT INTO china_fulfillment_calendar_commands
               (id,actor_id,payload_hash,resulting_version,created_at)
               SELECT ?,?,?,?,? WHERE changes()=1`,
            )
            .bind(input.commandId, actor.id, payloadHash, version, now),
          db
            .prepare(
              `INSERT INTO china_fulfillment_calendar_exceptions
               (version,calendar_date,is_working,reason)
               SELECT ?,json_extract(value,'$.date'),
                 json_extract(value,'$.isWorking'),json_extract(value,'$.reason')
               FROM json_each(?)
               WHERE EXISTS(SELECT 1 FROM china_fulfillment_calendar_commands WHERE id=?)`,
            )
            .bind(version, JSON.stringify(draft.exceptions), input.commandId),
          db
            .prepare(
              `UPDATE china_fulfillment_calendar_versions SET status='superseded'
               WHERE status='current' AND EXISTS(
                 SELECT 1 FROM china_fulfillment_calendar_commands WHERE id=?)`,
            )
            .bind(input.commandId),
          db
            .prepare(
              `UPDATE china_fulfillment_calendar_versions SET status='current',
                 confirmed_by=?,confirmed_at=? WHERE version=? AND status='draft'
                 AND EXISTS(SELECT 1 FROM china_fulfillment_calendar_commands WHERE id=?)`,
            )
            .bind(actor.id, now, version, input.commandId),
          db
            .prepare(
              `INSERT INTO admin_audit_events
               (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
               SELECT ?,'china_calendar.published','china_calendar',?,?,?,?
               WHERE EXISTS(SELECT 1 FROM china_fulfillment_calendar_commands WHERE id=?)`,
            )
            .bind(
              `china-calendar:${input.commandId}`,
              String(version),
              actor.id,
              JSON.stringify({
                requestId: input.commandId,
                ipAddress: options.auditIp ?? null,
                previousVersion: input.expectedCurrentVersion,
                before,
                after: draft,
              }),
              now,
              input.commandId,
            ),
        ]);
      } catch {
        const completed = await replay();
        if (completed !== null) return completed;
        throw new Response("Calendar changed; reload before publishing", {
          status: 409,
        });
      }
      const completed = await replay();
      if (completed === null)
        throw new Response("Calendar changed; reload before publishing", {
          status: 409,
        });
      return completed;
    },
  };
}
