import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { validateEvidence } from "../../quote-review/domain/private-review";
import { requireAfterSalesPermission } from "../domain/permissions";
import { createD1OrderFacts } from "../infrastructure/d1-order-facts";
import { afterSalesCommandId, afterSalesText } from "./cancellation-service";

export type AfterSalesFileScope = "cancellation" | "case" | "inspection";

interface FileRow {
  id: string;
  order_id: string;
  scope_kind: AfterSalesFileScope;
  scope_id: string;
  uploader_role: "admin" | "customer";
  uploader_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  checksum: string;
  object_key: string;
  visibility: "internal" | "shared" | "customer";
  shared_at: string | null;
  share_reason: string | null;
  command_hash: string;
  created_at: string;
}

const scopeTables: Record<AfterSalesFileScope, string> = {
  cancellation: "order_cancellation_requests",
  case: "after_sales_cases",
  inspection: "after_sales_return_receipts",
};

export function projectAfterSalesFile(
  row: Pick<
    FileRow,
    | "id"
    | "scope_kind"
    | "scope_id"
    | "uploader_role"
    | "filename"
    | "content_type"
    | "byte_size"
    | "visibility"
    | "shared_at"
    | "share_reason"
    | "created_at"
  >,
) {
  return {
    id: row.id,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    uploaderRole: row.uploader_role,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    visibility: row.visibility,
    sharedAt: row.shared_at,
    shareReason: row.share_reason,
    createdAt: row.created_at,
  };
}

export type AfterSalesFileView = ReturnType<typeof projectAfterSalesFile>;

export function createAfterSalesFiles(
  db: D1Database,
  bucket: R2Bucket,
  options: { now?: () => Date } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const facts = createD1OrderFacts(db);

  async function assertScope(
    orderId: string,
    scopeKind: AfterSalesFileScope,
    scopeId: string,
  ) {
    const table = scopeTables[scopeKind];
    if (!table) throw new Response("Invalid evidence scope", { status: 400 });
    const row = await db
      .prepare(`SELECT 1 FROM ${table} WHERE id=? AND order_id=?`)
      .bind(scopeId, orderId)
      .first()
      .catch(() => null);
    if (!row) throw new Response("Evidence scope not found", { status: 404 });
  }

  async function store(input: {
    orderId: string;
    scopeKind: AfterSalesFileScope;
    scopeId: string;
    file: File;
    commandId: string;
    uploaderRole: "admin" | "customer";
    uploaderId: string;
  }) {
    const commandId = afterSalesCommandId(input.commandId);
    await assertScope(input.orderId, input.scopeKind, input.scopeId);
    const validated = await validateEvidence(input.file);
    const commandHash = await piSha256(
      new TextEncoder().encode(
        JSON.stringify({
          orderId: input.orderId,
          scopeKind: input.scopeKind,
          scopeId: input.scopeId,
          uploaderId: input.uploaderId,
          checksum: validated.checksum,
          filename: validated.filename,
        }),
      ),
    );
    const replay = await db
      .prepare(
        `SELECT id,command_hash FROM after_sales_files WHERE command_id=?`,
      )
      .bind(commandId)
      .first<{ id: string; command_hash: string }>();
    if (replay) {
      if (replay.command_hash !== commandHash)
        throw new Response("Command identity conflict", { status: 409 });
      return replay.id;
    }
    const id = crypto.randomUUID();
    const key = `after-sales/${input.orderId}/${crypto.randomUUID()}`;
    await bucket.put(key, validated.bytes, {
      httpMetadata: { contentType: validated.contentType },
    });
    const timestamp = now();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO after_sales_files
             (id,order_id,scope_kind,scope_id,uploader_role,uploader_id,filename,
              content_type,byte_size,checksum,object_key,visibility,command_id,
              command_hash,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            input.orderId,
            input.scopeKind,
            input.scopeId,
            input.uploaderRole,
            input.uploaderId,
            validated.filename,
            validated.contentType,
            input.file.size,
            validated.checksum,
            key,
            input.uploaderRole === "customer" ? "customer" : "internal",
            commandId,
            commandHash,
            timestamp,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES (?,'order.after_sales_file_added','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `after-sales-file:${id}`,
            input.orderId,
            input.uploaderId,
            JSON.stringify({
              fileId: id,
              scopeKind: input.scopeKind,
              scopeId: input.scopeId,
              checksum: validated.checksum,
            }),
            timestamp,
          ),
      ]);
    } catch (error) {
      await bucket.delete(key);
      const concurrent = await db
        .prepare(
          `SELECT id,command_hash FROM after_sales_files WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; command_hash: string }>();
      if (concurrent?.command_hash === commandHash) return concurrent.id;
      throw error;
    }
    return id;
  }

  async function stream(row: FileRow) {
    const object = await bucket.get(row.object_key);
    if (!object) throw new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": row.content_type,
        "Content-Disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  async function row(orderId: string, fileId: string) {
    const file = await db
      .prepare(`SELECT * FROM after_sales_files WHERE id=? AND order_id=?`)
      .bind(fileId, orderId)
      .first<FileRow>();
    if (!file) throw new Response("Not found", { status: 404 });
    return file;
  }

  return {
    async adminUpload(
      actor: AdminIdentity,
      input: {
        orderId: string;
        scopeKind: AfterSalesFileScope;
        scopeId: string;
        file: File;
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      return store({ ...input, uploaderRole: "admin", uploaderId: actor.id });
    },

    async customerUpload(
      profileId: string,
      input: {
        orderId: string;
        scopeKind: "case";
        scopeId: string;
        file: File;
        commandId: string;
      },
    ) {
      const orderId = await facts.ownedOrder(profileId, input.orderId);
      if (input.scopeKind !== "case")
        throw new Response("Invalid evidence scope", { status: 400 });
      return store({
        ...input,
        orderId,
        uploaderRole: "customer",
        uploaderId: profileId,
      });
    },

    /**
     * Attaches a file to a customer-visible Case operation record (RA,
     * decline, closure, inspection decision). The file is stored as Admin
     * evidence, shared with the customer and linked to that record.
     */
    async adminAttachToEvent(
      actor: AdminIdentity,
      input: {
        orderId: string;
        caseId: string;
        eventId: string;
        file: File;
        commandId: string;
        label: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const fileId = await store({
        orderId: input.orderId,
        scopeKind: "case",
        scopeId: input.caseId,
        file: input.file,
        commandId: input.commandId,
        uploaderRole: "admin",
        uploaderId: actor.id,
      });
      const timestamp = now();
      await db.batch([
        db
          .prepare(
            `UPDATE after_sales_files SET visibility='shared',shared_by=?,shared_at=?,
               share_reason=? WHERE id=? AND order_id=? AND visibility='internal'`,
          )
          .bind(actor.id, timestamp, input.label, fileId, input.orderId),
        db
          .prepare(
            `INSERT INTO after_sales_event_files(event_id,file_id,created_at)
             VALUES(?,?,?) ON CONFLICT(event_id,file_id) DO NOTHING`,
          )
          .bind(input.eventId, fileId, timestamp),
      ]);
      return fileId;
    },

    async adminList(actor: AdminIdentity, orderId: string) {
      requireAfterSalesPermission(actor, "after_sales.review");
      return (
        await db
          .prepare(
            `SELECT * FROM after_sales_files WHERE order_id=? ORDER BY created_at,id`,
          )
          .bind(orderId)
          .all<FileRow>()
      ).results.map(projectAfterSalesFile);
    },

    async customerList(profileId: string, orderId: string) {
      const owned = await facts.ownedOrder(profileId, orderId);
      return (
        await db
          .prepare(
            `SELECT * FROM after_sales_files WHERE order_id=?
               AND visibility IN ('customer','shared') ORDER BY created_at,id`,
          )
          .bind(owned)
          .all<FileRow>()
      ).results.map(projectAfterSalesFile);
    },

    async adminDownload(actor: AdminIdentity, orderId: string, fileId: string) {
      requireAfterSalesPermission(actor, "after_sales.review");
      return stream(await row(orderId, fileId));
    },

    async customerDownload(profileId: string, orderId: string, fileId: string) {
      const owned = await facts.ownedOrder(profileId, orderId);
      const file = await row(owned, fileId);
      if (file.visibility === "internal")
        throw new Response("Not found", { status: 404 });
      return stream(file);
    },

    async adminShare(
      actor: AdminIdentity,
      input: { orderId: string; fileId: string; reason: string },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const reason = afterSalesText(input.reason, "Share reason", 500);
      const file = await row(input.orderId, input.fileId);
      if (file.visibility === "shared") return;
      if (file.visibility !== "internal")
        throw new Response("Only internal evidence can be shared", {
          status: 409,
        });
      const timestamp = now();
      await db.batch([
        db
          .prepare(
            `UPDATE after_sales_files SET visibility='shared',shared_by=?,shared_at=?,
               share_reason=? WHERE id=? AND order_id=? AND visibility='internal'`,
          )
          .bind(actor.id, timestamp, reason, file.id, input.orderId),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'order.after_sales_file_shared','confirmed_order',?,?,?,?
             WHERE changes()=1`,
          )
          .bind(
            `after-sales-file-share:${file.id}`,
            input.orderId,
            actor.id,
            JSON.stringify({ fileId: file.id, reason }),
            timestamp,
          ),
      ]);
    },
  };
}
