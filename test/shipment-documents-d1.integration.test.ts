import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import {
  createShipmentDocumentsService,
  recoverStaleShipmentUploads,
} from "../app/modules/shipment/application/shipment-documents-service";
import type { AdminIdentity } from "../workers/admin-access";

const directory = mkdtempSync(join(tmpdir(), "shipment-documents-d1-"));
let platform: Awaited<
  ReturnType<
    typeof getPlatformProxy<{
      DB: D1Database;
      PRIVATE_FILES: R2Bucket;
    }>
  >
>;
let db: D1Database;
let bucket: R2Bucket;
const actor: AdminIdentity = {
  id: "shipment-owner",
  email: "owner@example.test",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};
const now = "2026-09-24T00:00:00.000Z";
const hash = "a".repeat(64);

beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{
    DB: D1Database;
    PRIVATE_FILES: R2Bucket;
  }>({
    configPath: "wrangler.jsonc",
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  bucket = platform.env.PRIVATE_FILES;
  const sql = `
    INSERT INTO customer_profiles
      (id,email_normalized,email_display,email_verified_at,created_at,updated_at)
    VALUES ('owner-profile','buyer@example.test','buyer@example.test','${now}','${now}','${now}'),
      ('other-profile','other@example.test','other@example.test','${now}','${now}','${now}');
    INSERT INTO customer_purchasing_contexts
      (id,kind,individual_profile_id,created_at,updated_at)
    VALUES ('owner-context','individual','owner-profile','${now}','${now}');
    INSERT INTO seller_payment_instruction_versions
      (id,channel,version,instructions,status,command_id,created_by,created_at)
    VALUES ('shipment-test-payment','bank_transfer',1,'Test bank','current',
      'shipment-payment-command','test','${now}');
    INSERT INTO customer_quote_requests
      (id,reference_number,profile_id,purchasing_context_id,source_session_id,
       source_session_version,source_address_id,purchasing_context_kind,
       fulfillment_term,currency,merchandise_subtotal,service_fee_total,
       idempotency_key,snapshot_json,submitted_at)
    VALUES ('shipment-request','QR-SHIPMENT-TEST','owner-profile','owner-context',
      'shipment-session','1','shipment-address','individual','DDP','USD',100,0,
      'shipment-request-key','{}','${now}');
    INSERT INTO quote_revisions
      (id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,
       command_id,command_hash,issued_by,issued_at)
    VALUES ('shipment-revision','shipment-request',1,1,'{}','${hash}',
      'shipment-revision-command','${hash}','test','${now}');
    INSERT INTO proforma_invoice_intents
      (id,command_id,command_hash,request_id,quote_revision_id,quote_revision_hash,
       source_revision_json,seller_identity_id,seller_version,payment_instruction_id,
       payment_instruction_version,payment_channel,snapshot_json,snapshot_hash,
       issued_by,issued_at,valid_until)
    VALUES ('shipment-pi','shipment-pi-command','${hash}','shipment-request',
      'shipment-revision','${hash}','{}','seller-identity-initial',1,
      'shipment-test-payment',1,'bank_transfer','{}','${hash}',
      'test','${now}','2026-10-24T00:00:00.000Z');
    INSERT INTO proforma_invoices
      (id,request_id,quote_revision_id,document_number,document_version,
       snapshot_json,snapshot_hash,pdf_object_key,pdf_sha256,pdf_byte_size,
       pdf_page_count,pdf_renderer_version,payment_channel,issued_by,issued_at,valid_until)
    VALUES ('shipment-pi','shipment-request','shipment-revision','PI-SHIPMENT-TEST',1,
      '{}','${hash}','pi/shipment-test.pdf','${hash}',1,1,'legacy',
      'bank_transfer','test','${now}','2026-10-24T00:00:00.000Z');
    INSERT INTO pi_customer_views
      (id,pi_id,request_id,profile_id,purchasing_context_id,document_version,
       snapshot_hash,pdf_sha256,pdf_byte_size,kind,occurred_at,request_evidence_json)
    VALUES ('shipment-view','shipment-pi','shipment-request','owner-profile',
      'owner-context',1,'${hash}','${hash}',1,'view','${now}','{}');
    INSERT INTO pi_acceptances
      (id,pi_id,request_id,profile_id,purchasing_context_id,source,document_version,
       snapshot_hash,quote_revision_id,view_id,accepted_at,business_hash,evidence_json)
    VALUES ('shipment-acceptance','shipment-pi','shipment-request','owner-profile',
      'owner-context','website',1,'${hash}','shipment-revision','shipment-view',
      '${now}','${hash}','{}');
    INSERT INTO pi_payment_confirmations
      (id,command_id,command_hash,pi_id,confirmed_cents,currency,actual_channel,
       external_reference,actor_id,confirmed_at)
    VALUES ('shipment-confirmation','shipment-confirmation-command','${hash}',
      'shipment-pi',10000,'USD','bank_transfer','ref-shipment','test','${now}');
    INSERT INTO confirmed_orders
      (id,order_number,request_id,pi_id,purchasing_context_id,acceptance_id,
       confirmation_id,snapshot_json,snapshot_hash,currency,total_cents,confirmed_at)
    VALUES ('shipment-order','ORDER-SHIPMENT-TEST','shipment-request','shipment-pi',
      'owner-context','shipment-acceptance','shipment-confirmation',
      '{}','${hash}','USD',10000,'${now}');
    INSERT INTO order_shipments
      (id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
    VALUES ('shipment-one','shipment-order','together',1,'Ship together',
      '{"id":"together"}','${now}','${now}');`;
  const statements = sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  await db.batch(statements.map((statement) => db.prepare(statement)));
}, 60_000);

afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("saves optional packing with version checks and without altering commercial snapshots", async () => {
  const service = createShipmentDocumentsService(db, bucket);
  const draft = {
    cartons: [
      {
        count: 2,
        dimensionUnit: "cm" as const,
        length: 50,
        width: 40,
        height: 30,
        weightUnit: "kg" as const,
        grossWeight: 12,
      },
    ],
    dimensionalDivisor: {
      value: 5000,
      dimensionUnit: "cm" as const,
      weightUnit: "kg" as const,
    },
    notes: "Two measured cartons",
  };
  const commandId = crypto.randomUUID();
  const input = {
    orderId: "shipment-order",
    shipmentId: "shipment-one",
    expectedVersion: 0,
    commandId,
    draft,
  };
  expect(await service.savePacking(actor, input)).toBe(1);
  expect(await service.savePacking(actor, input)).toBe(1);
  await expect(
    service.savePacking(actor, {
      ...input,
      commandId: crypto.randomUUID(),
      draft: { ...draft, notes: "Changed" },
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await service.adminList(actor, "shipment-order", "shipment-one")).packing,
  ).toMatchObject({
    version: 1,
    totals: { cartonCount: 2, grossKg: 24, dimensionalKg: 24 },
  });
  expect(
    await db
      .prepare(
        "SELECT snapshot_hash FROM confirmed_orders WHERE id='shipment-order'",
      )
      .first("snapshot_hash"),
  ).toBe(hash);
});

it("keeps private files private until shared, and revocation immediately blocks downloads", async () => {
  const service = createShipmentDocumentsService(db, bucket);
  const bytes = new TextEncoder().encode("%PDF-1.4\nTest packing list");
  const file = new File([bytes], "packing-list.pdf", {
    type: "application/pdf",
  });
  const commandId = crypto.randomUUID();
  const documentId = await service.upload(actor, {
    orderId: "shipment-order",
    shipmentId: "shipment-one",
    commandId,
    kind: "packing_list",
    file,
  });
  expect(
    await service.upload(actor, {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      commandId,
      kind: "packing_list",
      file,
    }),
  ).toBe(documentId);
  expect(
    (await service.adminList(actor, "shipment-order", "shipment-one"))
      .documents,
  ).toMatchObject([{ id: documentId, visibility: "internal" }]);
  expect(
    await service.customerList(
      "owner-profile",
      "shipment-order",
      "shipment-one",
    ),
  ).toMatchObject({ documents: [], documentPage: 1, hasMoreDocuments: false });
  await expect(
    service.customerDownload(
      "owner-profile",
      "shipment-order",
      "shipment-one",
      documentId,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.customerList("other-profile", "shipment-order", "shipment-one"),
  ).rejects.toMatchObject({ status: 404 });
  const shareCommandId = crypto.randomUUID();
  expect(
    await service.changeVisibility(actor, {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      documentId,
      expectedVersion: 1,
      commandId: shareCommandId,
      visibility: "customer_shared",
    }),
  ).toBe(2);
  const shareAudit = await db
    .prepare("SELECT payload_json FROM admin_audit_events WHERE id=?")
    .bind(`shipment-document-visibility:${shareCommandId}`)
    .first<{ payload_json: string }>();
  expect(JSON.parse(shareAudit!.payload_json)).toMatchObject({
    before: { visibility: "internal" },
    after: { visibility: "customer_shared" },
  });
  expect(
    await service.customerList(
      "owner-profile",
      "shipment-order",
      "shipment-one",
    ),
  ).toMatchObject({
    documents: [{ id: documentId, visibility: "customer_shared" }],
  });
  const response = await service.customerDownload(
    "owner-profile",
    "shipment-order",
    "shipment-one",
    documentId,
  );
  expect(await response.text()).toBe("%PDF-1.4\nTest packing list");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const revokeCommandId = crypto.randomUUID();
  expect(
    await service.changeVisibility(actor, {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      documentId,
      expectedVersion: 2,
      commandId: revokeCommandId,
      visibility: "internal",
    }),
  ).toBe(3);
  const revokeAudit = await db
    .prepare("SELECT payload_json FROM admin_audit_events WHERE id=?")
    .bind(`shipment-document-visibility:${revokeCommandId}`)
    .first<{ payload_json: string }>();
  expect(JSON.parse(revokeAudit!.payload_json)).toMatchObject({
    before: { visibility: "customer_shared" },
    after: { visibility: "internal" },
  });
  await expect(
    service.customerDownload(
      "owner-profile",
      "shipment-order",
      "shipment-one",
      documentId,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    await service.adminDownload(
      actor,
      "shipment-order",
      "shipment-one",
      documentId,
    ),
  ).toBeInstanceOf(Response);
});

it("recovers a failed upload reservation and rejects invalid file content", async () => {
  const file = new File(
    [new TextEncoder().encode("%PDF-1.4\nRetry")],
    "retry.pdf",
    { type: "application/pdf" },
  );
  const commandId = crypto.randomUUID();
  const failingBucket = {
    put: async () => {
      throw new Error("injected R2 failure");
    },
    get: bucket.get.bind(bucket),
    delete: bucket.delete.bind(bucket),
  } as unknown as R2Bucket;
  await expect(
    createShipmentDocumentsService(db, failingBucket).upload(actor, {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      commandId,
      kind: "packing_list",
      file,
    }),
  ).rejects.toThrow("injected R2 failure");
  expect(
    await db
      .prepare("SELECT status FROM shipment_documents WHERE command_id=?")
      .bind(commandId)
      .first("status"),
  ).toBe("uploading");
  const service = createShipmentDocumentsService(db, bucket);
  expect(
    await service.upload(actor, {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      commandId,
      kind: "packing_list",
      file,
    }),
  ).toEqual(expect.any(String));
  await expect(
    service.upload(actor, {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      commandId: crypto.randomUUID(),
      kind: "packing_list",
      file: new File(["not a PDF"], "bad.pdf", { type: "application/pdf" }),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.upload(actor, {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      commandId: crypto.randomUUID(),
      kind: "packing_list",
      file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.pdf", {
        type: "application/pdf",
      }),
    }),
  ).rejects.toMatchObject({ status: 400 });
});

it("retires orphaned private objects with retryable, non-starving cleanup", async () => {
  const file = new File(["%PDF-1.4\nOrphan"], "orphan.pdf", {
    type: "application/pdf",
  });
  const commandId = crypto.randomUUID();
  const writeThenFail = {
    put: async (key: string, bytes: ArrayBuffer) => {
      await bucket.put(key, bytes);
      throw new Error("injected D1 outage after object write");
    },
    get: bucket.get.bind(bucket),
    delete: bucket.delete.bind(bucket),
  } as unknown as R2Bucket;
  await expect(
    createShipmentDocumentsService(db, writeThenFail).upload(actor, {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      commandId,
      kind: "packing_list",
      file,
    }),
  ).rejects.toThrow(/injected/);
  const reservation = await db
    .prepare(
      "SELECT object_key,status FROM shipment_documents WHERE command_id=?",
    )
    .bind(commandId)
    .first<{ object_key: string; status: string }>();
  expect(reservation?.status).toBe("uploading");
  expect(await bucket.get(reservation!.object_key)).not.toBeNull();
  const deleteFails = {
    delete: async () => {
      throw new Error("injected R2 deletion failure");
    },
  } as unknown as R2Bucket;
  await expect(
    recoverStaleShipmentUploads(
      db,
      deleteFails,
      "9999-01-01T00:00:00.000Z",
      "9999-01-01T00:00:00.000Z",
    ),
  ).rejects.toThrow(/cleanup attempts failed/);
  expect(
    await db
      .prepare(
        "SELECT status,object_cleaned_at FROM shipment_documents WHERE command_id=?",
      )
      .bind(commandId)
      .first(),
  ).toMatchObject({ status: "failed", object_cleaned_at: null });
  expect(
    await recoverStaleShipmentUploads(
      db,
      bucket,
      "9999-01-01T00:00:00.000Z",
      "9999-01-01T00:00:00.000Z",
    ),
  ).toBe(1);
  expect(await bucket.get(reservation!.object_key)).toBeNull();
  await bucket.put(reservation!.object_key, "%PDF-1.4\nLate write");
  expect(
    await recoverStaleShipmentUploads(
      db,
      bucket,
      "9999-01-01T00:00:00.000Z",
      "1970-01-01T00:00:00.000Z",
    ),
  ).toBe(1);
  expect(await bucket.get(reservation!.object_key)).toBeNull();
  expect(
    await recoverStaleShipmentUploads(
      db,
      bucket,
      "9999-01-01T00:00:00.000Z",
      "9999-01-01T00:00:00.000Z",
    ),
  ).toBe(0);
});

it("pages shipment file lists without returning private object keys", async () => {
  const service = createShipmentDocumentsService(db, bucket);
  await db.batch(
    Array.from({ length: 21 }, (_, index) => {
      const id = `paged-shipment-file-${String(index).padStart(2, "0")}`;
      return db
        .prepare(
          `INSERT INTO shipment_documents
           (id,order_id,shipment_id,command_id,payload_hash,kind,filename,
            content_type,byte_size,checksum,object_key,status,visibility,version,
            uploaded_by,created_at,updated_at)
           VALUES (?,?,?,?,?,'packing_list',?,'application/pdf',1,?,?,'ready',
             'customer_shared',1,?,?,?)`,
        )
        .bind(
          id,
          "shipment-order",
          "shipment-one",
          `command-${id}`,
          hash,
          `${id}.pdf`,
          hash,
          `private/${id}`,
          actor.id,
          now,
          now,
        );
    }),
  );
  const first = await service.customerList(
    "owner-profile",
    "shipment-order",
    "shipment-one",
  );
  const second = await service.customerList(
    "owner-profile",
    "shipment-order",
    "shipment-one",
    2,
  );
  expect(first).toMatchObject({ documentPage: 1, hasMoreDocuments: true });
  expect(first.documents).toHaveLength(20);
  expect(second).toMatchObject({ documentPage: 2, hasMoreDocuments: false });
  expect(second.documents).toHaveLength(1);
  expect(first.documents[0]).not.toHaveProperty("objectKey");
  expect(
    (await service.adminList(actor, "shipment-order", "shipment-one"))
      .documents,
  ).toHaveLength(20);
});

it("removes a late object when cleanup wins an in-flight upload", async () => {
  let startPut!: () => void;
  let releasePut!: () => void;
  const putting = new Promise<void>((resolve) => {
    startPut = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releasePut = resolve;
  });
  const delayedBucket = {
    put: async (key: string, bytes: ArrayBuffer) => {
      startPut();
      await released;
      await bucket.put(key, bytes);
    },
    get: bucket.get.bind(bucket),
    delete: bucket.delete.bind(bucket),
  } as unknown as R2Bucket;
  const commandId = crypto.randomUUID();
  const pending = createShipmentDocumentsService(db, delayedBucket).upload(
    actor,
    {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      commandId,
      kind: "packing_list",
      file: new File(["%PDF-1.4\nDelayed"], "delayed.pdf", {
        type: "application/pdf",
      }),
    },
  );
  await putting;
  const row = await db
    .prepare("SELECT object_key FROM shipment_documents WHERE command_id=?")
    .bind(commandId)
    .first<{ object_key: string }>();
  expect(
    await recoverStaleShipmentUploads(
      db,
      bucket,
      "9999-01-01T00:00:00.000Z",
      "9999-01-01T00:00:00.000Z",
    ),
  ).toBe(1);
  releasePut();
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect(await bucket.get(row!.object_key)).toBeNull();
});

it("audits before-and-after packing and locks it after dispatch", async () => {
  const service = createShipmentDocumentsService(db, bucket);
  const initial = (
    await service.adminList(actor, "shipment-order", "shipment-one")
  ).packing!;
  const commandId = crypto.randomUUID();
  expect(
    await service.savePacking(actor, {
      orderId: "shipment-order",
      shipmentId: "shipment-one",
      expectedVersion: initial.version,
      commandId,
      auditRequestId: "test-request-1",
      auditIp: "192.0.2.1",
      draft: {
        cartons: [{ ...initial.cartons[0], length: 55 }],
        dimensionalDivisor: initial.dimensionalDivisor,
        notes: "Final checked packing",
      },
    }),
  ).toBe(initial.version + 1);
  const audit = await db
    .prepare("SELECT payload_json FROM admin_audit_events WHERE id=?")
    .bind(`shipment-packing:${commandId}`)
    .first<{ payload_json: string }>();
  expect(JSON.parse(audit!.payload_json)).toMatchObject({
    requestId: "test-request-1",
    ipAddress: "192.0.2.1",
    before: { cartons: [{ length: 50 }] },
    after: { cartons: [{ length: 55 }], notes: "Final checked packing" },
  });
  await db
    .prepare(
      "UPDATE order_shipments SET status='shipped',version=version+1 WHERE id='shipment-one'",
    )
    .run();
  const lateCommandId = crypto.randomUUID();
  const lateInput = {
    orderId: "shipment-order",
    shipmentId: "shipment-one",
    expectedVersion: initial.version + 1,
    commandId: lateCommandId,
    draft: {
      cartons: [{ ...initial.cartons[0], length: 60 }],
      dimensionalDivisor: initial.dimensionalDivisor,
      notes: "Verified after carrier handoff",
    },
  };
  expect(await service.savePacking(actor, lateInput)).toBe(initial.version + 2);
  expect(await service.savePacking(actor, lateInput)).toBe(initial.version + 2);
  await expect(
    service.savePacking(actor, {
      ...lateInput,
      expectedVersion: initial.version + 2,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const lateAudit = await db
    .prepare("SELECT payload_json FROM admin_audit_events WHERE id=?")
    .bind(`shipment-packing:${lateCommandId}`)
    .first<{ payload_json: string }>();
  expect(JSON.parse(lateAudit!.payload_json)).toMatchObject({
    before: { notes: "Final checked packing" },
    after: { notes: "Verified after carrier handoff" },
  });
});
