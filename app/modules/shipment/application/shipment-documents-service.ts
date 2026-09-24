import type { AdminIdentity } from "#workers/admin-access";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import {
  digest,
  validateEvidence,
} from "../../quote-review/domain/private-review";
import {
  packingTotals,
  validatedPackingDraft,
  type ShipmentPackingDraft,
} from "../domain/shipment-packing";

export type ShipmentDocumentKind =
  | "packing_list"
  | "readiness_evidence"
  | "inspection_evidence"
  | "customs_file"
  | "logistics_document";

const DOCUMENT_PAGE_SIZE = 20;

function documentPage(page: number) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    throw new Response("Invalid document page", { status: 400 });
  return page;
}

interface DocumentRow {
  id: string;
  order_id: string;
  shipment_id: string;
  command_id: string;
  payload_hash: string;
  kind: ShipmentDocumentKind;
  filename: string;
  content_type: string;
  byte_size: number;
  checksum: string;
  object_key: string;
  status: "uploading" | "ready" | "failed";
  visibility: "internal" | "customer_shared";
  version: number;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

interface PackingRow {
  shipment_id: string;
  version: number;
  cartons_json: string;
  dimensional_divisor_json: string | null;
  notes: string;
  updated_at: string;
}

function assertAdmin(actor: AdminIdentity) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}

function commandIdentity(value: string) {
  if (!/^[0-9a-f-]{36}$/.test(value))
    throw new Response("Command identity required", { status: 400 });
}

function publicDocument(row: DocumentRow) {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    visibility: row.visibility,
    version: row.version,
    createdAt: row.created_at,
  };
}

export async function recoverStaleShipmentUploads(
  db: D1Database,
  bucket: R2Bucket,
  before: string,
  recheckSince: string,
) {
  const stale = (
    await db
      .prepare(
        `SELECT id,object_key,status FROM shipment_documents
         WHERE (status='uploading' AND object_cleaned_at IS NULL AND created_at<?)
            OR (status='failed' AND
              ((object_cleaned_at IS NULL AND created_at<?)
               OR (object_cleaned_at<? AND created_at>=?)))
         ORDER BY COALESCE(object_cleaned_at,created_at),id LIMIT 50`,
      )
      .bind(before, before, before, recheckSince)
      .all<{ id: string; object_key: string; status: string }>()
  ).results;
  let cleaned = 0;
  let failed = 0;
  for (const row of stale) {
    try {
      if (row.status === "uploading") {
        const claimed = await db
          .prepare(
            `UPDATE shipment_documents SET status='failed',updated_at=?
             WHERE id=? AND status='uploading' AND object_cleaned_at IS NULL`,
          )
          .bind(new Date().toISOString(), row.id)
          .run();
        if (claimed.meta.changes !== 1) continue;
      }
      await bucket.delete(row.object_key);
      const result = await db
        .prepare(
          `UPDATE shipment_documents SET object_cleaned_at=?,updated_at=?
           WHERE id=? AND status='failed'
             AND (object_cleaned_at IS NULL OR object_cleaned_at<?)`,
        )
        .bind(
          new Date().toISOString(),
          new Date().toISOString(),
          row.id,
          before,
        )
        .run();
      cleaned += result.meta.changes ?? 0;
    } catch {
      failed++;
    }
  }
  if (failed)
    throw new Error(`${failed} shipment upload cleanup attempts failed`);
  return cleaned;
}

export function createShipmentDocumentsService(
  db: D1Database,
  bucket: R2Bucket,
) {
  async function adminShipment(
    actor: AdminIdentity,
    orderId: string,
    shipmentId: string,
  ) {
    assertAdmin(actor);
    const row = await db
      .prepare(
        "SELECT id,display_name,sequence_number,status FROM order_shipments WHERE id=? AND order_id=?",
      )
      .bind(shipmentId, orderId)
      .first<{
        id: string;
        display_name: string;
        sequence_number: number;
        status: string;
      }>();
    if (!row) throw new Response("Shipment not found", { status: 404 });
    return row;
  }

  async function ownedShipment(
    profileId: string,
    orderId: string,
    shipmentId: string,
  ) {
    if (!profileId) throw new Response("Forbidden", { status: 403 });
    const row = await db
      .prepare(
        `SELECT shipment.id FROM order_shipments shipment
       JOIN confirmed_orders o ON o.id=shipment.order_id
       JOIN customer_quote_requests request ON request.id=o.request_id
       ${ownedQuoteRequestWhere} AND o.id=? AND shipment.id=?`,
      )
      .bind(profileId, profileId, profileId, orderId, shipmentId)
      .first();
    if (!row) throw new Response("Shipment not found", { status: 404 });
  }

  async function documentBytes(row: DocumentRow) {
    const object = await bucket.get(row.object_key);
    if (!object) throw new Response("Shipment file not found", { status: 404 });
    const bytes = await object.arrayBuffer();
    if ((await digest(bytes)) !== row.checksum)
      throw new Response("Shipment file integrity failure", { status: 409 });
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${row.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  return {
    async adminList(
      actor: AdminIdentity,
      orderId: string,
      shipmentId: string,
      page = 1,
    ) {
      const shipment = await adminShipment(actor, orderId, shipmentId);
      documentPage(page);
      const packing = await db
        .prepare(
          "SELECT shipment_id,version,cartons_json,dimensional_divisor_json,notes,updated_at FROM shipment_packing_records WHERE shipment_id=?",
        )
        .bind(shipmentId)
        .first<PackingRow>();
      const documents = (
        await db
          .prepare(
            `SELECT * FROM shipment_documents
         WHERE shipment_id=? AND status='ready'
         ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
          )
          .bind(
            shipmentId,
            DOCUMENT_PAGE_SIZE + 1,
            (page - 1) * DOCUMENT_PAGE_SIZE,
          )
          .all<DocumentRow>()
      ).results;
      const draft = packing
        ? {
            cartons: JSON.parse(
              packing.cartons_json,
            ) as ShipmentPackingDraft["cartons"],
            dimensionalDivisor: packing.dimensional_divisor_json
              ? (JSON.parse(
                  packing.dimensional_divisor_json,
                ) as ShipmentPackingDraft["dimensionalDivisor"])
              : null,
            notes: packing.notes,
          }
        : null;
      return {
        shipment: {
          id: shipment.id,
          displayName: shipment.display_name,
          sequenceNumber: shipment.sequence_number,
        },
        packing: draft
          ? {
              ...draft,
              version: packing!.version,
              updatedAt: packing!.updated_at,
              totals: packingTotals(draft),
            }
          : null,
        documents: documents.slice(0, DOCUMENT_PAGE_SIZE).map(publicDocument),
        documentPage: page,
        hasMoreDocuments: documents.length > DOCUMENT_PAGE_SIZE,
      };
    },

    async customerList(
      profileId: string,
      orderId: string,
      shipmentId: string,
      page = 1,
    ) {
      await ownedShipment(profileId, orderId, shipmentId);
      documentPage(page);
      const documents = (
        await db
          .prepare(
            `SELECT * FROM shipment_documents
         WHERE shipment_id=? AND status='ready' AND visibility='customer_shared'
         ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
          )
          .bind(
            shipmentId,
            DOCUMENT_PAGE_SIZE + 1,
            (page - 1) * DOCUMENT_PAGE_SIZE,
          )
          .all<DocumentRow>()
      ).results;
      return {
        documents: documents.slice(0, DOCUMENT_PAGE_SIZE).map(publicDocument),
        documentPage: page,
        hasMoreDocuments: documents.length > DOCUMENT_PAGE_SIZE,
      };
    },

    async savePacking(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        expectedVersion: number;
        commandId: string;
        draft: ShipmentPackingDraft;
        auditRequestId?: string;
        auditIp?: string | null;
      },
    ) {
      const shipment = await adminShipment(
        actor,
        input.orderId,
        input.shipmentId,
      );
      if (["shipped", "delivered"].includes(shipment.status))
        throw new Response("Final packing cannot change after dispatch", {
          status: 409,
        });
      commandIdentity(input.commandId);
      const draft = validatedPackingDraft(input.draft);
      const payloadHash = await digest(
        new TextEncoder().encode(JSON.stringify(draft)).buffer,
      );
      const replay = async () =>
        db
          .prepare(
            "SELECT actor_id,shipment_id,payload_hash,resulting_version FROM shipment_packing_commands WHERE id=?",
          )
          .bind(input.commandId)
          .first<{
            actor_id: string;
            shipment_id: string;
            payload_hash: string;
            resulting_version: number;
          }>();
      const prior = await replay();
      if (prior) {
        if (
          prior.actor_id !== actor.id ||
          prior.shipment_id !== input.shipmentId ||
          prior.payload_hash !== payloadHash
        )
          throw new Response("Command identity conflict", { status: 409 });
        return prior.resulting_version;
      }
      const current = await db
        .prepare(
          "SELECT version,cartons_json,dimensional_divisor_json,notes FROM shipment_packing_records WHERE shipment_id=?",
        )
        .bind(input.shipmentId)
        .first<
          Pick<
            PackingRow,
            "version" | "cartons_json" | "dimensional_divisor_json" | "notes"
          >
        >();
      if ((current?.version ?? 0) !== input.expectedVersion)
        throw new Response("Packing record changed; reload before saving", {
          status: 409,
        });
      const now = new Date().toISOString();
      const previousDraft = current
        ? {
            cartons: JSON.parse(current.cartons_json),
            dimensionalDivisor: current.dimensional_divisor_json
              ? JSON.parse(current.dimensional_divisor_json)
              : null,
            notes: current.notes,
          }
        : null;
      const write = current
        ? db
            .prepare(
              `UPDATE shipment_packing_records SET cartons_json=?,dimensional_divisor_json=?,notes=?,version=version+1,
               updated_by=?,updated_at=? WHERE shipment_id=? AND version=?`,
            )
            .bind(
              JSON.stringify(draft.cartons),
              draft.dimensionalDivisor
                ? JSON.stringify(draft.dimensionalDivisor)
                : null,
              draft.notes,
              actor.id,
              now,
              input.shipmentId,
              input.expectedVersion,
            )
        : db
            .prepare(
              `INSERT INTO shipment_packing_records
               (shipment_id,order_id,version,cartons_json,dimensional_divisor_json,notes,updated_by,updated_at)
             SELECT ?,?,1,?,?,?,?,? WHERE NOT EXISTS(
               SELECT 1 FROM shipment_packing_records WHERE shipment_id=?)`,
            )
            .bind(
              input.shipmentId,
              input.orderId,
              JSON.stringify(draft.cartons),
              draft.dimensionalDivisor
                ? JSON.stringify(draft.dimensionalDivisor)
                : null,
              draft.notes,
              actor.id,
              now,
              input.shipmentId,
            );
      try {
        await db.batch([
          write,
          db
            .prepare(
              `INSERT INTO shipment_packing_commands
               (id,shipment_id,actor_id,payload_hash,resulting_version,created_at)
             SELECT ?,?,?,?,?,? WHERE changes()=1`,
            )
            .bind(
              input.commandId,
              input.shipmentId,
              actor.id,
              payloadHash,
              input.expectedVersion + 1,
              now,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events
               (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'shipment.packing_saved','order_shipment',?,?,?,?
             WHERE EXISTS(SELECT 1 FROM shipment_packing_commands WHERE id=?)`,
            )
            .bind(
              `shipment-packing:${input.commandId}`,
              input.shipmentId,
              actor.id,
              JSON.stringify({
                version: input.expectedVersion + 1,
                commandId: input.commandId,
                requestId: input.auditRequestId ?? null,
                ipAddress: input.auditIp ?? null,
                before: previousDraft,
                after: draft,
              }),
              now,
              input.commandId,
            ),
        ]);
      } catch (error) {
        const completed = await replay();
        if (
          completed?.payload_hash === payloadHash &&
          completed.actor_id === actor.id &&
          completed.shipment_id === input.shipmentId
        )
          return completed.resulting_version;
        if (
          error instanceof Error &&
          error.message.includes("Final packing cannot change after dispatch")
        )
          throw new Response("Final packing cannot change after dispatch", {
            status: 409,
          });
        throw error;
      }
      const completed = await replay();
      if (!completed)
        throw new Response("Packing record changed; reload before saving", {
          status: 409,
        });
      return completed.resulting_version;
    },

    async upload(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        commandId: string;
        kind: ShipmentDocumentKind;
        file: File;
        auditRequestId?: string;
        auditIp?: string | null;
      },
    ) {
      await adminShipment(actor, input.orderId, input.shipmentId);
      commandIdentity(input.commandId);
      if (
        ![
          "packing_list",
          "readiness_evidence",
          "inspection_evidence",
          "customs_file",
          "logistics_document",
        ].includes(input.kind)
      )
        throw new Response("Invalid shipment document kind", { status: 400 });
      const validated = await validateEvidence(input.file);
      const payloadHash = await digest(
        new TextEncoder().encode(
          JSON.stringify([
            input.orderId,
            input.shipmentId,
            input.kind,
            validated.filename,
            validated.contentType,
            validated.checksum,
          ]),
        ).buffer,
      );
      let row = await db
        .prepare("SELECT * FROM shipment_documents WHERE command_id=?")
        .bind(input.commandId)
        .first<DocumentRow>();
      if (!row) {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await db
          .prepare(
            `INSERT INTO shipment_documents
             (id,order_id,shipment_id,command_id,payload_hash,kind,filename,
              content_type,byte_size,checksum,object_key,status,visibility,version,
              uploaded_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'uploading','internal',1,?,?,?)
           ON CONFLICT(command_id) DO NOTHING`,
          )
          .bind(
            id,
            input.orderId,
            input.shipmentId,
            input.commandId,
            payloadHash,
            input.kind,
            validated.filename,
            validated.contentType,
            input.file.size,
            validated.checksum,
            `shipment-documents/${crypto.randomUUID()}`,
            actor.id,
            now,
            now,
          )
          .run();
        row = await db
          .prepare("SELECT * FROM shipment_documents WHERE command_id=?")
          .bind(input.commandId)
          .first<DocumentRow>();
      }
      if (
        !row ||
        row.order_id !== input.orderId ||
        row.shipment_id !== input.shipmentId ||
        row.uploaded_by !== actor.id ||
        row.payload_hash !== payloadHash
      )
        throw new Response("Command identity conflict", { status: 409 });
      if (row.status === "ready") return row.id;
      if (row.status !== "uploading")
        throw new Response("Upload recovery required; start a new upload", {
          status: 409,
        });
      if (Date.now() - Date.parse(row.created_at) >= 60 * 60 * 1000)
        throw new Response("Upload reservation expired; start a new upload", {
          status: 409,
        });
      await bucket.put(row.object_key, validated.bytes, {
        httpMetadata: { contentType: validated.contentType },
      });
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            `UPDATE shipment_documents SET status='ready',updated_at=?
           WHERE id=? AND status='uploading'`,
          )
          .bind(now, row.id),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
           SELECT ?,'shipment.document_uploaded','order_shipment',?,?,?,?
           WHERE changes()=1 ON CONFLICT(id) DO NOTHING`,
          )
          .bind(
            `shipment-document:${row.id}`,
            input.shipmentId,
            actor.id,
            JSON.stringify({
              documentId: row.id,
              kind: input.kind,
              commandId: input.commandId,
              requestId: input.auditRequestId ?? null,
              ipAddress: input.auditIp ?? null,
            }),
            now,
          ),
      ]);
      const result = await db
        .prepare("SELECT status FROM shipment_documents WHERE id=?")
        .bind(row.id)
        .first<{ status: string }>();
      if (result?.status !== "ready") {
        if (result?.status === "failed") await bucket.delete(row.object_key);
        throw new Response("Upload was interrupted; retry the same command", {
          status: 409,
        });
      }
      return row.id;
    },

    async changeVisibility(
      actor: AdminIdentity,
      input: {
        orderId: string;
        shipmentId: string;
        documentId: string;
        expectedVersion: number;
        commandId: string;
        visibility: "internal" | "customer_shared";
        auditRequestId?: string;
        auditIp?: string | null;
      },
    ) {
      await adminShipment(actor, input.orderId, input.shipmentId);
      commandIdentity(input.commandId);
      if (!["internal", "customer_shared"].includes(input.visibility))
        throw new Response("Invalid visibility", { status: 400 });
      const payloadHash = await digest(
        new TextEncoder().encode(
          JSON.stringify([
            input.orderId,
            input.shipmentId,
            input.documentId,
            input.visibility,
          ]),
        ).buffer,
      );
      const replay = async () =>
        db
          .prepare(
            "SELECT actor_id,document_id,payload_hash,resulting_version FROM shipment_document_changes WHERE id=?",
          )
          .bind(input.commandId)
          .first<{
            actor_id: string;
            document_id: string;
            payload_hash: string;
            resulting_version: number;
          }>();
      const prior = await replay();
      if (prior) {
        if (
          prior.actor_id !== actor.id ||
          prior.document_id !== input.documentId ||
          prior.payload_hash !== payloadHash
        )
          throw new Response("Command identity conflict", { status: 409 });
        return prior.resulting_version;
      }
      const now = new Date().toISOString();
      try {
        await db.batch([
          db
            .prepare(
              `UPDATE shipment_documents SET visibility=?,version=version+1,
               shared_by=?,shared_at=?,updated_at=?
             WHERE id=? AND order_id=? AND shipment_id=? AND status='ready'
               AND version=? AND visibility!=?`,
            )
            .bind(
              input.visibility,
              input.visibility === "customer_shared" ? actor.id : null,
              input.visibility === "customer_shared" ? now : null,
              now,
              input.documentId,
              input.orderId,
              input.shipmentId,
              input.expectedVersion,
              input.visibility,
            ),
          db
            .prepare(
              `INSERT INTO shipment_document_changes
               (id,document_id,actor_id,payload_hash,resulting_version,created_at)
             SELECT ?,?,?,?,?,? WHERE changes()=1`,
            )
            .bind(
              input.commandId,
              input.documentId,
              actor.id,
              payloadHash,
              input.expectedVersion + 1,
              now,
            ),
          db
            .prepare(
              `INSERT INTO admin_audit_events
               (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             SELECT ?,'shipment.document_visibility_changed','order_shipment',?,?,?,?
             WHERE EXISTS(SELECT 1 FROM shipment_document_changes WHERE id=?)`,
            )
            .bind(
              `shipment-document-visibility:${input.commandId}`,
              input.shipmentId,
              actor.id,
              JSON.stringify({
                documentId: input.documentId,
                before: {
                  visibility:
                    input.visibility === "customer_shared"
                      ? "internal"
                      : "customer_shared",
                },
                after: { visibility: input.visibility },
                version: input.expectedVersion + 1,
                commandId: input.commandId,
                requestId: input.auditRequestId ?? null,
                ipAddress: input.auditIp ?? null,
              }),
              now,
              input.commandId,
            ),
        ]);
      } catch (error) {
        const completed = await replay();
        if (
          completed?.actor_id === actor.id &&
          completed.document_id === input.documentId &&
          completed.payload_hash === payloadHash
        )
          return completed.resulting_version;
        throw error;
      }
      const completed = await replay();
      if (!completed)
        throw new Response("Shipment document changed; reload before editing", {
          status: 409,
        });
      return completed.resulting_version;
    },

    async adminDownload(
      actor: AdminIdentity,
      orderId: string,
      shipmentId: string,
      documentId: string,
    ) {
      await adminShipment(actor, orderId, shipmentId);
      const row = await db
        .prepare(
          `SELECT * FROM shipment_documents WHERE id=? AND order_id=? AND shipment_id=?
         AND status='ready'`,
        )
        .bind(documentId, orderId, shipmentId)
        .first<DocumentRow>();
      if (!row) throw new Response("Shipment file not found", { status: 404 });
      return documentBytes(row);
    },

    async customerDownload(
      profileId: string,
      orderId: string,
      shipmentId: string,
      documentId: string,
    ) {
      await ownedShipment(profileId, orderId, shipmentId);
      const row = await db
        .prepare(
          `SELECT * FROM shipment_documents WHERE id=? AND order_id=? AND shipment_id=?
         AND status='ready' AND visibility='customer_shared'`,
        )
        .bind(documentId, orderId, shipmentId)
        .first<DocumentRow>();
      if (!row) throw new Response("Shipment file not found", { status: 404 });
      return documentBytes(row);
    },
  };
}
