import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPrivateReview } from "../app/modules/quote-review/infrastructure/d1-private-review";
import type { AdminIdentity } from "../workers/admin-access";
import { createD1QuoteRequestRepository } from "../app/modules/quote-request/infrastructure/d1-quote-request-repository";

const directory = mkdtempSync(join(tmpdir(), "private-review-"));
let platform: Awaited<
  ReturnType<
    typeof getPlatformProxy<{ DB: D1Database; PRIVATE_FILES: R2Bucket }>
  >
>;
let db: D1Database;
const actor: AdminIdentity = {
  id: "local-owner",
  email: "owner@local.invalid",
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
  platform = await getPlatformProxy<{
    DB: D1Database;
    PRIVATE_FILES: R2Bucket;
  }>({
    configPath: "wrangler.jsonc",
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  await db.batch([
    db.prepare(
      "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES('review-profile','review@example.com','review@example.com','2026-09-14','2026-09-14','2026-09-14')",
    ),
    db.prepare(
      "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,created_at,updated_at) VALUES('review-context','individual','review-profile','2026-09-14','2026-09-14')",
    ),
    ...["review-one", "review-two"].map((id) =>
      db
        .prepare(
          "INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at) VALUES(?,?,'review-profile','review-context','session','1','address','individual','DDP','USD',0,0,?,'{}','2026-09-14')",
        )
        .bind(id, id, id),
    ),
  ]);
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("persists append-only notes with actor/audit and never modifies RFQ snapshots", async () => {
  const service = createPrivateReview(db, platform.env.PRIVATE_FILES, actor);
  const commandId = crypto.randomUUID();
  const id = await service.appendNote(
    "review-one",
    "PRIVATE_FACTORY_NOTE",
    commandId,
  );
  expect(
    await service.appendNote("review-one", "PRIVATE_FACTORY_NOTE", commandId),
  ).toBe(id);
  await expect(
    service.appendNote("review-one", "different", commandId),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    db
      .prepare("UPDATE quote_internal_notes SET body='changed' WHERE id=?")
      .bind(id)
      .run(),
  ).rejects.toThrow(/append only/);
  await expect(
    db.prepare("DELETE FROM quote_internal_notes WHERE id=?").bind(id).run(),
  ).rejects.toThrow(/append only/);
  expect((await service.list("review-one")).notes[0]).toMatchObject({
    body: "PRIVATE_FACTORY_NOTE",
    actor_id: actor.id,
  });
  expect(
    await db
      .prepare(
        "SELECT snapshot_json FROM customer_quote_requests WHERE id='review-one'",
      )
      .first(),
  ).toEqual({ snapshot_json: "{}" });
  expect(
    await db
      .prepare("SELECT actor_id FROM admin_audit_events WHERE id=?")
      .bind(`private-review:${id}`)
      .first(),
  ).toEqual({ actor_id: actor.id });
});

it("uses private local R2 with immutable metadata and fails closed on cross-quote, actor and expired access", async () => {
  const service = createPrivateReview(db, platform.env.PRIVATE_FILES, actor);
  const uploadCommand = crypto.randomUUID();
  const id = await service.upload(
    "review-one",
    "tax_exemption",
    new File(["%PDF-1.4\nPRIVATE_TAX_EVIDENCE"], "tax.pdf", {
      type: "application/pdf",
    }),
    uploadCommand,
  );
  expect(
    await service.upload(
      "review-one",
      "tax_exemption",
      new File(["%PDF-1.4\nPRIVATE_TAX_EVIDENCE"], "tax.pdf", {
        type: "application/pdf",
      }),
      uploadCommand,
    ),
  ).toBe(id);
  expect(
    await db
      .prepare("SELECT actor_id FROM admin_audit_events WHERE id=?")
      .bind(`private-review:${id}`)
      .first(),
  ).toEqual({ actor_id: actor.id });
  const metadata = await db
    .prepare("SELECT * FROM quote_private_evidence WHERE id=?")
    .bind(id)
    .first();
  expect(metadata).toMatchObject({
    visibility: "internal",
    version: 1,
    actor_id: actor.id,
    kind: "tax_exemption",
  });
  await expect(
    db.prepare("DELETE FROM quote_private_evidence WHERE id=?").bind(id).run(),
  ).rejects.toThrow(/immutable/);
  await expect(
    db
      .prepare(
        "UPDATE quote_private_evidence SET filename='replaced' WHERE id=?",
      )
      .bind(id)
      .run(),
  ).rejects.toThrow(/immutable/);
  await expect(service.grant("review-two", id)).rejects.toMatchObject({
    status: 404,
  });
  const token = await service.grant("review-one", id);
  const response = await service.download("review-one", token);
  expect(await response.text()).toContain("PRIVATE_TAX_EVIDENCE");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(JSON.stringify(await service.list("review-one"))).not.toContain(
    "object_key",
  );
  await expect(service.download("review-two", token)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    createPrivateReview(db, platform.env.PRIVATE_FILES, {
      ...actor,
      id: "another-admin",
    }).download("review-one", token),
  ).rejects.toMatchObject({ status: 404 });
  await db
    .prepare("UPDATE quote_private_download_grants SET expires_at='2000-01-01'")
    .run();
  await expect(service.download("review-one", token)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    service.download("review-one", "malformed"),
  ).rejects.toMatchObject({ status: 404 });
  expect(() =>
    createPrivateReview(db, platform.env.PRIVATE_FILES, { ...actor, id: "" }),
  ).toThrow();
  const freshToken = await service.grant("review-one", id);
  const objectKey = String(metadata?.object_key);
  await platform.env.PRIVATE_FILES.put(objectKey, "tampered bytes");
  await expect(
    service.download("review-one", freshToken),
  ).rejects.toMatchObject({ status: 409 });
  const customerRepository = createD1QuoteRequestRepository(db);
  const customerData = JSON.stringify([
    await customerRepository.listOwned("review-profile"),
    await customerRepository.findOwned("review-profile", "review-one"),
  ]);
  for (const secret of [
    "PRIVATE_FACTORY_NOTE",
    "PRIVATE_TAX_EVIDENCE",
    "tax.pdf",
    objectKey,
    "quote_private_evidence",
    "quote_internal_notes",
  ])
    expect(customerData).not.toContain(secret);
});

it("rolls back notes, evidence and R2 writes when the atomic audit fails", async () => {
  const service = createPrivateReview(db, platform.env.PRIVATE_FILES, actor);
  const before = await platform.env.PRIVATE_FILES.list({
    prefix: "quote-review/",
  });
  await db
    .prepare(
      "CREATE TRIGGER fail_private_audit BEFORE INSERT ON admin_audit_events WHEN NEW.event_type LIKE 'quote_review.%' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
    )
    .run();
  try {
    await expect(
      service.appendNote("review-two", "must rollback", crypto.randomUUID()),
    ).rejects.toThrow(/audit unavailable/);
    await expect(
      service.upload(
        "review-two",
        "supporting",
        new File(["%PDF-1.4\nrollback"], "rollback.pdf", {
          type: "application/pdf",
        }),
        crypto.randomUUID(),
      ),
    ).rejects.toThrow(/audit unavailable/);
    expect(await service.list("review-two")).toEqual({ notes: [], files: [] });
    expect(
      (
        await platform.env.PRIVATE_FILES.list({ prefix: "quote-review/" })
      ).objects.map((o) => o.key),
    ).toEqual(before.objects.map((o) => o.key));
  } finally {
    await db.prepare("DROP TRIGGER fail_private_audit").run();
  }
});
