export interface PiPdfJob {
  type: "pi-pdf";
  commandId: string;
}

export function createPiPdfJobs(
  db: D1Database,
  queue: { send(message: PiPdfJob): Promise<unknown> },
  renderReserved: (commandId: string) => Promise<unknown>,
  now: () => Date = () => new Date(),
) {
  return {
    async dispatch() {
      const timestamp = now().toISOString();
      const rows = await db
        .prepare(
          `SELECT command_id FROM proforma_invoice_pdf_jobs
         WHERE (state='pending' AND next_attempt_at<=?)
            OR (state='processing' AND lease_until<=?)
         ORDER BY next_attempt_at LIMIT 25`,
        )
        .bind(timestamp, timestamp)
        .all<{ command_id: string }>();
      for (const row of rows.results)
        await queue.send({ type: "pi-pdf", commandId: row.command_id });
    },
    async consume(value: unknown) {
      if (
        !value ||
        typeof value !== "object" ||
        !("type" in value) ||
        value.type !== "pi-pdf"
      )
        return false;
      if (!("commandId" in value) || typeof value.commandId !== "string")
        return true;
      const timestamp = now().toISOString();
      const lease = crypto.randomUUID();
      const row = await db
        .prepare(
          `UPDATE proforma_invoice_pdf_jobs SET state='processing',attempts=attempts+1,
           lease_token=?,lease_until=?
         WHERE command_id=? AND attempts<5 AND
           ((state='pending' AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?))
         RETURNING attempts`,
        )
        .bind(
          lease,
          new Date(now().getTime() + 300000).toISOString(),
          value.commandId,
          timestamp,
          timestamp,
        )
        .first<{ attempts: number }>();
      if (!row) {
        await db
          .prepare(
            `UPDATE proforma_invoice_pdf_jobs SET state='failed',lease_token=NULL,lease_until=NULL
           WHERE command_id=? AND attempts>=5 AND state='processing' AND lease_until<=?`,
          )
          .bind(value.commandId, timestamp)
          .run();
        return true;
      }
      try {
        await renderReserved(value.commandId);
        await db
          .prepare(
            `UPDATE proforma_invoice_pdf_jobs SET state='completed',completed_at=?,lease_token=NULL,lease_until=NULL
           WHERE command_id=? AND lease_token=?`,
          )
          .bind(now().toISOString(), value.commandId, lease)
          .run();
      } catch {
        await db
          .prepare(
            `UPDATE proforma_invoice_pdf_jobs SET state=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL
           WHERE command_id=? AND lease_token=?`,
          )
          .bind(
            row.attempts >= 5 ? "failed" : "pending",
            new Date(
              now().getTime() + Math.min(3600, 30 * 2 ** row.attempts) * 1000,
            ).toISOString(),
            value.commandId,
            lease,
          )
          .run();
      }
      return true;
    },
  };
}
